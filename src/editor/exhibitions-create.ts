import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadExhibitionUnit } from "../content-loaders/exhibitions/repository.ts";
import { isContentId } from "./content-id.ts";
import {
  createExhibitionsEditorDraft,
  validateExhibitionsEditorDraft,
  type ExhibitionsEditorDraftState,
} from "./exhibitions-draft-state.ts";
import { serializeExhibitionsEditorDraft } from "./exhibitions-serializer.ts";
import {
  readExhibitionsEditorEntry,
  type ExhibitionsEditorEntryState,
} from "./exhibitions-state.ts";
import { createHash } from "node:crypto";
import {
  inspectExhibitionsHeroCandidate,
  temporaryExhibitionsHeroAssetStore,
  type TemporaryExhibitionsHeroAssetStore,
} from "./exhibitions-hero-assets.ts";
import { createExhibitionsHeroPublishEvidence } from "./exhibitions-hero-publish-evidence.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";

const names = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/exhibitions");
export class ExhibitionsCreateError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "content-id-collision"
    | "asset-name-conflict"
    | "asset-temp-not-found"
    | "asset-temp-expired"
    | "asset-temp-unsafe"
    | "unsafe-exhibitions-root"
    | "canonical-mismatch"
    | "exhibitions-create-rollback-failed"
    | "create-failed";
  constructor(
    message: string,
    code: ExhibitionsCreateError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExhibitionsCreateError";
    this.code = code;
  }
}

export type ExhibitionsCreateHeroInput = {
  token: string;
  createWorkspaceId: string;
  sha256: string;
  format: "avif" | "jpg" | "png" | "webp";
};

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export async function createExhibitionsThreeFileEntryWithHero(
  draft: ExhibitionsEditorDraftState,
  hero: ExhibitionsCreateHeroInput,
  options: {
    root?: string;
    assetRoot?: string;
    store?: TemporaryExhibitionsHeroAssetStore;
    fileSystem?: ExhibitionsCreateFileSystem;
    reread?: ExhibitionsCreateReader;
    repositoryRoot?: string;
    evidenceStore?: HeroAssetPublishEvidenceStore;
  } = {},
) {
  const root = path.resolve(options.root ?? canonicalRoot);
  const assetRoot = path.resolve(options.assetRoot ?? "public/images/exhibitions");
  const io = options.fileSystem ?? fs;
  const store = options.store ?? (await temporaryExhibitionsHeroAssetStore);
  const repositoryRoot = path.resolve(
    options.repositoryRoot ??
      (options.root ? path.dirname(path.resolve(options.root)) : "."),
  );
  const evidenceStore =
    options.evidenceStore ?? new HeroAssetPublishEvidenceStore(repositoryRoot);
  if (
    !isContentId(draft.contentId) ||
    !validateExhibitionsEditorDraft(draft).capabilities.save
  )
    throw new ExhibitionsCreateError(
      "Exhibition draft has blocking issues",
      "invalid-draft",
    );
  const destination = await absent(draft.contentId, root, io);
  if (await evidenceStore.read("exhibitions", draft.contentId))
    throw new ExhibitionsCreateError(
      "Unresolved Hero Publish evidence already owns this Content ID",
      "content-id-collision",
    );
  let temporary;
  try {
    temporary = await store.read(
      hero.token,
      `create-${hero.createWorkspaceId}`,
      hero.createWorkspaceId,
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      [
        "asset-temp-not-found",
        "asset-temp-expired",
        "asset-temp-unsafe",
      ].includes(code ?? "")
    )
      throw new ExhibitionsCreateError(
        error instanceof Error ? error.message : "Temporary Hero unavailable",
        code as
          "asset-temp-not-found" | "asset-temp-expired" | "asset-temp-unsafe",
        { cause: error },
      );
    throw error;
  }
  const inspected = await inspectExhibitionsHeroCandidate({
    contentId: draft.contentId,
    declaredMime: temporary.metadata.mime,
    bytes: temporary.bytes,
  });
  const finalSrc = inspected.proposedSrc;
  if (
    inspected.sha256 !== hero.sha256 ||
    inspected.media.format !== hero.format ||
    draft.shared.state !== "editable" ||
    draft.shared.value.hero.image !== finalSrc
  )
    throw new ExhibitionsCreateError(
      "Temporary Hero does not match the current Create draft",
      "asset-temp-unsafe",
    );

  const assetRootStat = await io.lstat(assetRoot).catch(() => undefined);
  if (!assetRootStat?.isDirectory() || assetRootStat.isSymbolicLink())
    throw new ExhibitionsCreateError(
      "Unsafe Exhibitions asset root",
      "unsafe-exhibitions-root",
    );
  const target = path.resolve(assetRoot, `${draft.contentId}.${hero.format}`);
  if (path.dirname(target) !== assetRoot)
    throw new ExhibitionsCreateError(
      "Unsafe Exhibitions Hero target",
      "invalid-content-id",
    );
  const targetStat = await io.lstat(target).catch(() => undefined);
  if (targetStat) {
    if (!targetStat.isFile() || targetStat.isSymbolicLink())
      throw new ExhibitionsCreateError(
        "Unsafe existing Exhibitions Hero target",
        "asset-name-conflict",
      );
    if (sha256(await io.readFile(target)) !== hero.sha256)
      throw new ExhibitionsCreateError(
        "Asset already exists for this Content ID",
        "asset-name-conflict",
      );
    const saved = await createExhibitionsThreeFileEntry(
      draft,
      root,
      io,
      options.reread,
    );
    try {
      await evidenceStore.write(
        await createExhibitionsHeroPublishEvidence({
          repositoryRoot,
          contentId: draft.contentId,
          src: finalSrc,
          declaredMime: temporary.metadata.mime,
          operation: "hero-asset-create",
          contentRoot: root,
          assetRoot,
        }),
      );
      await store.release(
        hero.token,
        `create-${hero.createWorkspaceId}`,
        hero.createWorkspaceId,
      );
      return saved;
    } catch (error) {
      const failures: unknown[] = [];
      await io
        .rm(destination, { recursive: true, force: false })
        .catch((failure) => failures.push(failure));
      await evidenceStore
        .delete("exhibitions", draft.contentId)
        .catch((failure) => failures.push(failure));
      if (failures.length)
        throw new ExhibitionsCreateError(
          "Failed to roll back Exhibition Create after Publish evidence failure",
          "exhibitions-create-rollback-failed",
          { cause: new AggregateError([error, ...failures]) },
        );
      throw new ExhibitionsCreateError(
        "Failed to create Exhibition Hero Publish evidence",
        "create-failed",
        { cause: error },
      );
    }
  }

  const output = serializeExhibitionsEditorDraft(draft);
  const id = `.exhibitions-create-hero-${randomUUID()}`;
  const stageRoot = path.join(root, id);
  const stage = path.join(stageRoot, draft.contentId);
  const assetStage = path.join(
    assetRoot,
    `${id}-${draft.contentId}.${hero.format}`,
  );
  let assetInstalled = false;
  let contentInstalled = false;
  let rollbackFailed = false;
  try {
    await io.mkdir(stageRoot);
    await io.mkdir(stage);
    for (const name of names)
      await io.writeFile(path.join(stage, name), output[name], {
        encoding: "utf8",
        flag: "wx",
      });
    const stagedUnit = await loadExhibitionUnit(stage);
    if (
      stagedUnit.shared.state !== "valid" ||
      stagedUnit.locales.ja.state !== "valid" ||
      stagedUnit.locales.en.state !== "valid"
    )
      throw new ExhibitionsCreateError(
        "Serialized Exhibition failed validation",
        "canonical-mismatch",
      );
    await io.writeFile(assetStage, temporary.bytes, { flag: "wx" });
    const stagedBytes = await io.readFile(assetStage);
    const stagedInspection = await inspectExhibitionsHeroCandidate({
      contentId: draft.contentId,
      declaredMime: temporary.metadata.mime,
      bytes: stagedBytes,
    });
    if (
      stagedInspection.sha256 !== hero.sha256 ||
      stagedInspection.proposedSrc !== finalSrc
    )
      throw new ExhibitionsCreateError(
        "Staged Hero failed verification",
        "asset-temp-unsafe",
      );
    await absent(draft.contentId, root, io);
    if (await io.lstat(target).catch(() => undefined))
      throw new ExhibitionsCreateError(
        "Asset already exists for this Content ID",
        "asset-name-conflict",
      );
    await io.rename(assetStage, target);
    assetInstalled = true;
    await io.rename(stage, destination);
    contentInstalled = true;
    const entry = await (options.reread ?? readExhibitionsEditorEntry)(
      draft.contentId,
      root,
    );
    const saved = entry ? createExhibitionsEditorDraft(entry) : undefined;
    if (!saved || sha256(await io.readFile(target)) !== hero.sha256)
      throw new ExhibitionsCreateError(
        "Created Exhibition failed final verification",
        "canonical-mismatch",
      );
    await evidenceStore.write(
      await createExhibitionsHeroPublishEvidence({
        repositoryRoot,
        contentId: draft.contentId,
        src: finalSrc,
        declaredMime: temporary.metadata.mime,
        operation: "hero-asset-create",
        contentRoot: root,
        assetRoot,
      }),
    );
    await store.release(
      hero.token,
      `create-${hero.createWorkspaceId}`,
      hero.createWorkspaceId,
    );
    return saved;
  } catch (error) {
    const failures: unknown[] = [];
    if (contentInstalled)
      await io
        .rm(destination, { recursive: true, force: false })
        .catch((failure) => failures.push(failure));
    if (assetInstalled)
      await io
        .rm(target, { force: false })
        .catch((failure) => failures.push(failure));
    await evidenceStore
      .delete("exhibitions", draft.contentId)
      .catch((failure) => failures.push(failure));
    if (failures.length) {
      rollbackFailed = true;
      throw new ExhibitionsCreateError(
        "Failed to roll back Exhibition Create with Hero",
        "exhibitions-create-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof ExhibitionsCreateError) throw error;
    throw new ExhibitionsCreateError(
      "Failed to create Exhibition with Hero",
      "create-failed",
      { cause: error },
    );
  } finally {
    if (!rollbackFailed)
      await Promise.all([
        io
          .rm(stageRoot, { recursive: true, force: true })
          .catch(() => undefined),
        io.rm(assetStage, { force: true }).catch(() => undefined),
      ]);
  }
}
export type ExhibitionsCreateFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "rm" | "writeFile"
>;
export type ExhibitionsCreateReader = (
  contentId: string,
  root: string,
) => Promise<ExhibitionsEditorEntryState | undefined>;

async function absent(id: string, root: string, io: ExhibitionsCreateFileSystem) {
  if (!isContentId(id))
    throw new ExhibitionsCreateError(
      "Invalid Exhibition Content ID",
      "invalid-content-id",
    );
  const resolved = path.resolve(root);
  const stat = await io.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new ExhibitionsCreateError("Unsafe Exhibitions root", "unsafe-exhibitions-root");
  const destination = path.resolve(resolved, id);
  if (path.dirname(destination) !== resolved)
    throw new ExhibitionsCreateError(
      "Invalid Exhibition Content ID",
      "invalid-content-id",
    );
  if (
    (await io.readdir(resolved)).some(
      (name) =>
        name.toLowerCase() === id.toLowerCase() ||
        name.toLowerCase() === `${id}.md`.toLowerCase(),
    )
  )
    throw new ExhibitionsCreateError(
      "Exhibition Content ID already exists",
      "content-id-collision",
    );
  return destination;
}

export async function createExhibitionsThreeFileEntry(
  draft: ExhibitionsEditorDraftState,
  root = canonicalRoot,
  io: ExhibitionsCreateFileSystem = fs,
  reread: ExhibitionsCreateReader = readExhibitionsEditorEntry,
) {
  if (!validateExhibitionsEditorDraft(draft).capabilities.save)
    throw new ExhibitionsCreateError(
      "Exhibition draft has blocking issues",
      "invalid-draft",
    );
  const destination = await absent(draft.contentId, root, io);
  const output = serializeExhibitionsEditorDraft(draft);
  const stageRoot = path.join(
    path.resolve(root),
    `.exhibitions-create-${randomUUID()}`,
  );
  const stage = path.join(stageRoot, draft.contentId);
  let committed = false;
  try {
    await io.mkdir(stageRoot);
    await io.mkdir(stage);
    for (const name of names)
      await io.writeFile(path.join(stage, name), output[name], {
        encoding: "utf8",
        flag: "wx",
      });
    const unit = await loadExhibitionUnit(stage);
    if (
      unit.shared.state !== "valid" ||
      unit.locales.ja.state !== "valid" ||
      unit.locales.en.state !== "valid"
    )
      throw new ExhibitionsCreateError(
        "Serialized Exhibition failed validation",
        "canonical-mismatch",
      );
    await absent(draft.contentId, root, io);
    await io.rename(stage, destination);
    committed = true;
    const entry = await reread(draft.contentId, root);
    const saved = entry ? createExhibitionsEditorDraft(entry) : undefined;
    if (!saved)
      throw new ExhibitionsCreateError(
        "Created Exhibition failed reread",
        "canonical-mismatch",
      );
    return saved;
  } catch (error) {
    if (committed)
      try {
        for (const name of names)
          if (
            (await io.readFile(path.join(destination, name), "utf8")) !==
            output[name]
          )
            throw new Error("created bytes changed");
        await io.rm(destination, { recursive: true, force: false });
      } catch (rollback) {
        throw new ExhibitionsCreateError(
          "Failed to roll back Exhibition Create",
          "exhibitions-create-rollback-failed",
          { cause: new AggregateError([error, rollback]) },
        );
      }
    if (error instanceof ExhibitionsCreateError) throw error;
    throw new ExhibitionsCreateError("Failed to create Exhibition", "create-failed", {
      cause: error,
    });
  } finally {
    await io
      .rm(stageRoot, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
