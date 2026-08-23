import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadArtistUnit } from "../content-loaders/artists/repository.ts";
import { isContentId } from "./content-id.ts";
import {
  createArtistsEditorDraft,
  validateArtistsEditorDraft,
  type ArtistsEditorDraftState,
} from "./artists-draft-state.ts";
import { serializeArtistsEditorDraft } from "./artists-serializer.ts";
import {
  readArtistsEditorEntry,
  type ArtistsEditorEntryState,
} from "./artists-state.ts";
import { createHash } from "node:crypto";
import {
  inspectArtistsHeroCandidate,
  temporaryArtistsHeroAssetStore,
  type TemporaryArtistsHeroAssetStore,
} from "./artists-hero-assets.ts";
import { createArtistsHeroPublishEvidence } from "./artists-hero-publish-evidence.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";

const names = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/artists");
export class ArtistsCreateError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "content-id-collision"
    | "asset-name-conflict"
    | "asset-temp-not-found"
    | "asset-temp-expired"
    | "asset-temp-unsafe"
    | "unsafe-artists-root"
    | "canonical-mismatch"
    | "artists-create-rollback-failed"
    | "create-failed";
  constructor(
    message: string,
    code: ArtistsCreateError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArtistsCreateError";
    this.code = code;
  }
}

export type ArtistsCreateHeroInput = {
  token: string;
  createWorkspaceId: string;
  sha256: string;
  format: "avif" | "jpg" | "png" | "webp";
};

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export async function createArtistsThreeFileEntryWithHero(
  draft: ArtistsEditorDraftState,
  hero: ArtistsCreateHeroInput,
  options: {
    root?: string;
    assetRoot?: string;
    store?: TemporaryArtistsHeroAssetStore;
    fileSystem?: ArtistsCreateFileSystem;
    reread?: ArtistsCreateReader;
    repositoryRoot?: string;
    evidenceStore?: HeroAssetPublishEvidenceStore;
  } = {},
) {
  const root = path.resolve(options.root ?? canonicalRoot);
  const assetRoot = path.resolve(options.assetRoot ?? "public/images/artists");
  const io = options.fileSystem ?? fs;
  const store = options.store ?? (await temporaryArtistsHeroAssetStore);
  const repositoryRoot = path.resolve(
    options.repositoryRoot ??
      (options.root ? path.dirname(path.resolve(options.root)) : "."),
  );
  const evidenceStore =
    options.evidenceStore ?? new HeroAssetPublishEvidenceStore(repositoryRoot);
  if (
    !isContentId(draft.contentId) ||
    !validateArtistsEditorDraft(draft).capabilities.save
  )
    throw new ArtistsCreateError(
      "Artist draft has blocking issues",
      "invalid-draft",
    );
  const destination = await absent(draft.contentId, root, io);
  if (await evidenceStore.read("artists", draft.contentId))
    throw new ArtistsCreateError(
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
      throw new ArtistsCreateError(
        error instanceof Error ? error.message : "Temporary Hero unavailable",
        code as
          "asset-temp-not-found" | "asset-temp-expired" | "asset-temp-unsafe",
        { cause: error },
      );
    throw error;
  }
  const inspected = await inspectArtistsHeroCandidate({
    contentId: draft.contentId,
    declaredMime: temporary.metadata.mime,
    bytes: temporary.bytes,
  });
  const finalSrc = inspected.proposedSrc;
  if (
    inspected.sha256 !== hero.sha256 ||
    inspected.media.format !== hero.format ||
    draft.data.hero.image !== finalSrc
  )
    throw new ArtistsCreateError(
      "Temporary Hero does not match the current Create draft",
      "asset-temp-unsafe",
    );

  const assetRootStat = await io.lstat(assetRoot).catch(() => undefined);
  if (!assetRootStat?.isDirectory() || assetRootStat.isSymbolicLink())
    throw new ArtistsCreateError(
      "Unsafe Artists asset root",
      "unsafe-artists-root",
    );
  const target = path.resolve(assetRoot, `${draft.contentId}.${hero.format}`);
  if (path.dirname(target) !== assetRoot)
    throw new ArtistsCreateError(
      "Unsafe Artists Hero target",
      "invalid-content-id",
    );
  const targetStat = await io.lstat(target).catch(() => undefined);
  if (targetStat) {
    if (!targetStat.isFile() || targetStat.isSymbolicLink())
      throw new ArtistsCreateError(
        "Unsafe existing Artists Hero target",
        "asset-name-conflict",
      );
    if (sha256(await io.readFile(target)) !== hero.sha256)
      throw new ArtistsCreateError(
        "Asset already exists for this Content ID",
        "asset-name-conflict",
      );
    const saved = await createArtistsThreeFileEntry(
      draft,
      root,
      io,
      options.reread,
    );
    try {
      await evidenceStore.write(
        await createArtistsHeroPublishEvidence({
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
        .delete("artists", draft.contentId)
        .catch((failure) => failures.push(failure));
      if (failures.length)
        throw new ArtistsCreateError(
          "Failed to roll back Artist Create after Publish evidence failure",
          "artists-create-rollback-failed",
          { cause: new AggregateError([error, ...failures]) },
        );
      throw new ArtistsCreateError(
        "Failed to create Artist Hero Publish evidence",
        "create-failed",
        { cause: error },
      );
    }
  }

  const output = serializeArtistsEditorDraft(draft);
  const id = `.artists-create-hero-${randomUUID()}`;
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
    const stagedUnit = await loadArtistUnit(stage);
    if (
      stagedUnit.identity.state !== "valid" ||
      stagedUnit.locales.ja.state !== "valid" ||
      stagedUnit.locales.en.state !== "valid"
    )
      throw new ArtistsCreateError(
        "Serialized Artist failed validation",
        "canonical-mismatch",
      );
    await io.writeFile(assetStage, temporary.bytes, { flag: "wx" });
    const stagedBytes = await io.readFile(assetStage);
    const stagedInspection = await inspectArtistsHeroCandidate({
      contentId: draft.contentId,
      declaredMime: temporary.metadata.mime,
      bytes: stagedBytes,
    });
    if (
      stagedInspection.sha256 !== hero.sha256 ||
      stagedInspection.proposedSrc !== finalSrc
    )
      throw new ArtistsCreateError(
        "Staged Hero failed verification",
        "asset-temp-unsafe",
      );
    await absent(draft.contentId, root, io);
    if (await io.lstat(target).catch(() => undefined))
      throw new ArtistsCreateError(
        "Asset already exists for this Content ID",
        "asset-name-conflict",
      );
    await io.rename(assetStage, target);
    assetInstalled = true;
    await io.rename(stage, destination);
    contentInstalled = true;
    const entry = await (options.reread ?? readArtistsEditorEntry)(
      draft.contentId,
      root,
    );
    const saved = entry ? createArtistsEditorDraft(entry) : undefined;
    if (!saved || sha256(await io.readFile(target)) !== hero.sha256)
      throw new ArtistsCreateError(
        "Created Artist failed final verification",
        "canonical-mismatch",
      );
    await evidenceStore.write(
      await createArtistsHeroPublishEvidence({
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
      .delete("artists", draft.contentId)
      .catch((failure) => failures.push(failure));
    if (failures.length) {
      rollbackFailed = true;
      throw new ArtistsCreateError(
        "Failed to roll back Artist Create with Hero",
        "artists-create-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof ArtistsCreateError) throw error;
    throw new ArtistsCreateError(
      "Failed to create Artist with Hero",
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
export type ArtistsCreateFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "rm" | "writeFile"
>;
export type ArtistsCreateReader = (
  contentId: string,
  root: string,
) => Promise<ArtistsEditorEntryState | undefined>;

async function absent(id: string, root: string, io: ArtistsCreateFileSystem) {
  if (!isContentId(id))
    throw new ArtistsCreateError(
      "Invalid Artist Content ID",
      "invalid-content-id",
    );
  const resolved = path.resolve(root);
  const stat = await io.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new ArtistsCreateError("Unsafe Artists root", "unsafe-artists-root");
  const destination = path.resolve(resolved, id);
  if (path.dirname(destination) !== resolved)
    throw new ArtistsCreateError(
      "Invalid Artist Content ID",
      "invalid-content-id",
    );
  if (
    (await io.readdir(resolved)).some(
      (name) =>
        name.toLowerCase() === id.toLowerCase() ||
        name.toLowerCase() === `${id}.md`.toLowerCase(),
    )
  )
    throw new ArtistsCreateError(
      "Artist Content ID already exists",
      "content-id-collision",
    );
  return destination;
}

export async function createArtistsThreeFileEntry(
  draft: ArtistsEditorDraftState,
  root = canonicalRoot,
  io: ArtistsCreateFileSystem = fs,
  reread: ArtistsCreateReader = readArtistsEditorEntry,
) {
  if (!validateArtistsEditorDraft(draft).capabilities.save)
    throw new ArtistsCreateError(
      "Artist draft has blocking issues",
      "invalid-draft",
    );
  const destination = await absent(draft.contentId, root, io);
  const output = serializeArtistsEditorDraft(draft);
  const stageRoot = path.join(
    path.resolve(root),
    `.artists-create-${randomUUID()}`,
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
    const unit = await loadArtistUnit(stage);
    if (
      unit.identity.state !== "valid" ||
      unit.locales.ja.state !== "valid" ||
      unit.locales.en.state !== "valid"
    )
      throw new ArtistsCreateError(
        "Serialized Artist failed validation",
        "canonical-mismatch",
      );
    await absent(draft.contentId, root, io);
    await io.rename(stage, destination);
    committed = true;
    const entry = await reread(draft.contentId, root);
    const saved = entry ? createArtistsEditorDraft(entry) : undefined;
    if (!saved)
      throw new ArtistsCreateError(
        "Created Artist failed reread",
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
        throw new ArtistsCreateError(
          "Failed to roll back Artist Create",
          "artists-create-rollback-failed",
          { cause: new AggregateError([error, rollback]) },
        );
      }
    if (error instanceof ArtistsCreateError) throw error;
    throw new ArtistsCreateError("Failed to create Artist", "create-failed", {
      cause: error,
    });
  } finally {
    await io
      .rm(stageRoot, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
