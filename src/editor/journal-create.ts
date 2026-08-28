import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadJournalUnit } from "../content-loaders/journal/repository.ts";
import type { JournalLocalized } from "../content-loaders/journal/schema.ts";
import { isContentId } from "./content-id.ts";
import {
  createJournalEditorDraft,
  type JournalEditorSharedDraft,
  validateJournalEditorDraft,
  type JournalEditorDraftState,
} from "./journal-draft-state.ts";
import { serializeJournalEditorDraft } from "./journal-serializer.ts";
import {
  readJournalEditorEntry,
  type JournalEditorEntryState,
} from "./journal-state.ts";
import { createHash } from "node:crypto";
import {
  inspectJournalHeroCandidate,
  temporaryJournalHeroAssetStore,
  type TemporaryJournalHeroAssetStore,
} from "./journal-hero-assets.ts";
import { createJournalHeroPublishEvidence } from "./journal-hero-publish-evidence.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";

const names = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/journal");

export function createNewJournalDraft(
  contentId: string,
): JournalEditorDraftState {
  const shared: JournalEditorSharedDraft = {
    visibility: "draft",
    date: "",
    category: "",
    hero: { image: "" },
  };
  const localized = (): JournalLocalized & { body: string } => ({
    title: "",
    summary: "",
    hero_alt: "",
    body: "",
  });
  return {
    contentId,
    shared: { state: "editable", value: shared },
    locales: {
      ja: { state: "editable", value: localized() },
      en: { state: "editable", value: localized() },
    },
  };
}
export class JournalCreateError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "content-id-collision"
    | "asset-name-conflict"
    | "asset-temp-not-found"
    | "asset-temp-expired"
    | "asset-temp-unsafe"
    | "unsafe-journal-root"
    | "canonical-mismatch"
    | "journal-create-rollback-failed"
    | "create-failed";
  constructor(
    message: string,
    code: JournalCreateError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JournalCreateError";
    this.code = code;
  }
}

export type JournalCreateHeroInput = {
  token: string;
  createWorkspaceId: string;
  sha256: string;
  format: "avif" | "jpg" | "png" | "webp";
};

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export async function createJournalThreeFileEntryWithHero(
  draft: JournalEditorDraftState,
  hero: JournalCreateHeroInput,
  options: {
    root?: string;
    assetRoot?: string;
    store?: TemporaryJournalHeroAssetStore;
    fileSystem?: JournalCreateFileSystem;
    reread?: JournalCreateReader;
    repositoryRoot?: string;
    evidenceStore?: HeroAssetPublishEvidenceStore;
  } = {},
) {
  const root = path.resolve(options.root ?? canonicalRoot);
  const assetRoot = path.resolve(options.assetRoot ?? "public/images/journal");
  const io = options.fileSystem ?? fs;
  const store = options.store ?? (await temporaryJournalHeroAssetStore);
  const repositoryRoot = path.resolve(
    options.repositoryRoot ??
      (options.root ? path.dirname(path.resolve(options.root)) : "."),
  );
  const evidenceStore =
    options.evidenceStore ?? new HeroAssetPublishEvidenceStore(repositoryRoot);
  if (
    !isContentId(draft.contentId) ||
    !validateJournalEditorDraft(draft).capabilities.save
  )
    throw new JournalCreateError(
      "Journal draft has blocking issues",
      "invalid-draft",
    );
  const destination = await absent(draft.contentId, root, io);
  if (await evidenceStore.read("journal", draft.contentId))
    throw new JournalCreateError(
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
      throw new JournalCreateError(
        error instanceof Error ? error.message : "Temporary Hero unavailable",
        code as
          "asset-temp-not-found" | "asset-temp-expired" | "asset-temp-unsafe",
        { cause: error },
      );
    throw error;
  }
  const inspected = inspectJournalHeroCandidate({
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
    throw new JournalCreateError(
      "Temporary Hero does not match the current Create draft",
      "asset-temp-unsafe",
    );

  const assetRootStat = await io.lstat(assetRoot).catch(() => undefined);
  if (!assetRootStat?.isDirectory() || assetRootStat.isSymbolicLink())
    throw new JournalCreateError(
      "Unsafe Journal asset root",
      "unsafe-journal-root",
    );
  const target = path.resolve(assetRoot, `${draft.contentId}.${hero.format}`);
  if (path.dirname(target) !== assetRoot)
    throw new JournalCreateError(
      "Unsafe Journal Hero target",
      "invalid-content-id",
    );
  const targetStat = await io.lstat(target).catch(() => undefined);
  if (targetStat) {
    if (!targetStat.isFile() || targetStat.isSymbolicLink())
      throw new JournalCreateError(
        "Unsafe existing Journal Hero target",
        "asset-name-conflict",
      );
    if (sha256(await io.readFile(target)) !== hero.sha256)
      throw new JournalCreateError(
        "Asset already exists for this Content ID",
        "asset-name-conflict",
      );
    const saved = await createJournalThreeFileEntry(
      draft,
      root,
      io,
      options.reread,
    );
    try {
      await evidenceStore.write(
        await createJournalHeroPublishEvidence({
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
        .delete("journal", draft.contentId)
        .catch((failure) => failures.push(failure));
      if (failures.length)
        throw new JournalCreateError(
          "Failed to roll back Journal Create after Publish evidence failure",
          "journal-create-rollback-failed",
          { cause: new AggregateError([error, ...failures]) },
        );
      throw new JournalCreateError(
        "Failed to create Journal Hero Publish evidence",
        "create-failed",
        { cause: error },
      );
    }
  }

  const output = serializeJournalEditorDraft(draft);
  const id = `.journal-create-hero-${randomUUID()}`;
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
    const stagedUnit = await loadJournalUnit(stage);
    if (
      stagedUnit.shared.state !== "valid" ||
      stagedUnit.locales.ja.state !== "valid" ||
      stagedUnit.locales.en.state !== "valid"
    )
      throw new JournalCreateError(
        "Serialized Journal failed validation",
        "canonical-mismatch",
      );
    await io.writeFile(assetStage, temporary.bytes, { flag: "wx" });
    const stagedBytes = await io.readFile(assetStage);
    const stagedInspection = inspectJournalHeroCandidate({
      contentId: draft.contentId,
      declaredMime: temporary.metadata.mime,
      bytes: stagedBytes,
    });
    if (
      stagedInspection.sha256 !== hero.sha256 ||
      stagedInspection.proposedSrc !== finalSrc
    )
      throw new JournalCreateError(
        "Staged Hero failed verification",
        "asset-temp-unsafe",
      );
    await absent(draft.contentId, root, io);
    if (await io.lstat(target).catch(() => undefined))
      throw new JournalCreateError(
        "Asset already exists for this Content ID",
        "asset-name-conflict",
      );
    await io.rename(assetStage, target);
    assetInstalled = true;
    await io.rename(stage, destination);
    contentInstalled = true;
    const entry = await (options.reread ?? readJournalEditorEntry)(
      draft.contentId,
      root,
    );
    const saved = entry ? createJournalEditorDraft(entry) : undefined;
    if (!saved || sha256(await io.readFile(target)) !== hero.sha256)
      throw new JournalCreateError(
        "Created Journal failed final verification",
        "canonical-mismatch",
      );
    await evidenceStore.write(
      await createJournalHeroPublishEvidence({
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
      .delete("journal", draft.contentId)
      .catch((failure) => failures.push(failure));
    if (failures.length) {
      rollbackFailed = true;
      throw new JournalCreateError(
        "Failed to roll back Journal Create with Hero",
        "journal-create-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof JournalCreateError) throw error;
    throw new JournalCreateError(
      "Failed to create Journal with Hero",
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
export type JournalCreateFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "rm" | "writeFile"
>;
export type JournalCreateReader = (
  contentId: string,
  root: string,
) => Promise<JournalEditorEntryState | undefined>;

async function absent(id: string, root: string, io: JournalCreateFileSystem) {
  if (!isContentId(id))
    throw new JournalCreateError(
      "Invalid Journal Content ID",
      "invalid-content-id",
    );
  const resolved = path.resolve(root);
  const stat = await io.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new JournalCreateError("Unsafe Journal root", "unsafe-journal-root");
  const destination = path.resolve(resolved, id);
  if (path.dirname(destination) !== resolved)
    throw new JournalCreateError(
      "Invalid Journal Content ID",
      "invalid-content-id",
    );
  if (
    (await io.readdir(resolved)).some(
      (name) =>
        name.toLowerCase() === id.toLowerCase() ||
        name.toLowerCase() === `${id}.md`.toLowerCase(),
    )
  )
    throw new JournalCreateError(
      "Journal Content ID already exists",
      "content-id-collision",
    );
  return destination;
}

export async function createJournalThreeFileEntry(
  draft: JournalEditorDraftState,
  root = canonicalRoot,
  io: JournalCreateFileSystem = fs,
  reread: JournalCreateReader = readJournalEditorEntry,
) {
  if (!validateJournalEditorDraft(draft).capabilities.save)
    throw new JournalCreateError(
      "Journal draft has blocking issues",
      "invalid-draft",
    );
  const destination = await absent(draft.contentId, root, io);
  const output = serializeJournalEditorDraft(draft);
  const stageRoot = path.join(
    path.resolve(root),
    `.journal-create-${randomUUID()}`,
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
    const unit = await loadJournalUnit(stage);
    if (
      unit.shared.state !== "valid" ||
      unit.locales.ja.state !== "valid" ||
      unit.locales.en.state !== "valid"
    )
      throw new JournalCreateError(
        "Serialized Journal failed validation",
        "canonical-mismatch",
      );
    await absent(draft.contentId, root, io);
    await io.rename(stage, destination);
    committed = true;
    const entry = await reread(draft.contentId, root);
    const saved = entry ? createJournalEditorDraft(entry) : undefined;
    if (!saved)
      throw new JournalCreateError(
        "Created Journal failed reread",
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
        throw new JournalCreateError(
          "Failed to roll back Journal Create",
          "journal-create-rollback-failed",
          { cause: new AggregateError([error, rollback]) },
        );
      }
    if (error instanceof JournalCreateError) throw error;
    throw new JournalCreateError("Failed to create Journal", "create-failed", {
      cause: error,
    });
  } finally {
    await io
      .rm(stageRoot, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

export const createJournalEditorEntry = createJournalThreeFileEntry;
