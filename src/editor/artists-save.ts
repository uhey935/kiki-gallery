import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import { createArtistsEditorDraft, validateArtistsEditorDraft, type ArtistsEditorDraftState } from "./artists-draft-state.ts";
import { serializeArtistsEditorDraft, type ArtistsSerializedFiles } from "./artists-serializer.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
import {
  ARTISTS_HERO_PREFIX,
  ArtistsHeroAssetError,
  inspectArtistsHeroCandidate,
  temporaryArtistsHeroAssetStore,
  type ArtistsHeroAssetDraft,
  type TemporaryArtistsHeroAssetStore,
} from "./artists-hero-assets.ts";

const files = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/artists");
export class ArtistsSaveError extends Error {
  readonly code: "invalid-content-id" | "invalid-draft" | "canonical-mismatch" | "asset-temp-not-found" | "asset-temp-expired" | "asset-temp-unsafe" | "asset-save-failed" | "artists-save-rollback-failed" | "save-failed";
  constructor(message: string, code: ArtistsSaveError["code"], options?: ErrorOptions) { super(message, options); this.name = "ArtistsSaveError"; this.code = code; }
}
export type ArtistsSaveFileSystem = Pick<typeof fs, "lstat" | "mkdir" | "readFile" | "rename" | "rm" | "writeFile">;

async function directoryFor(contentId: string, root: string, fileSystem: ArtistsSaveFileSystem) {
  if (!isContentId(contentId)) throw new ArtistsSaveError("Invalid Artist Content ID", "invalid-content-id");
  const resolvedRoot = path.resolve(root);
  const directory = path.resolve(resolvedRoot, contentId);
  const stat = await fileSystem.lstat(directory).catch(() => undefined);
  if (path.dirname(directory) !== resolvedRoot || !stat?.isDirectory() || stat.isSymbolicLink()) throw new ArtistsSaveError("Unsafe Artist unit", "invalid-content-id");
  return directory;
}

export async function writeArtistsSerializedFiles(contentId: string, next: ArtistsSerializedFiles, baseline: ArtistsSerializedFiles, root = canonicalRoot, fileSystem: ArtistsSaveFileSystem = fs) {
  const directory = await directoryFor(contentId, root, fileSystem);
  const id = `.artists-save-${randomUUID()}`;
  const stage = path.join(directory, `${id}-stage`);
  const backup = path.join(directory, `${id}-backup`);
  const replaced: (typeof files)[number][] = [];
  let manualRecoveryRequired = false;
  try {
    await fileSystem.mkdir(stage); await fileSystem.mkdir(backup);
    for (const name of files) {
      const target = path.join(directory, name);
      const stat = await fileSystem.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe Artist source: ${name}`);
      const current = await fileSystem.readFile(target, "utf8");
      if (current !== baseline[name]) throw new ArtistsSaveError("Canonical Artist changed during Save", "canonical-mismatch");
      await fileSystem.writeFile(path.join(stage, name), next[name], { encoding: "utf8", flag: "wx" });
      await fileSystem.writeFile(path.join(backup, name), current, { encoding: "utf8", flag: "wx" });
    }
    for (const name of files) { await fileSystem.rename(path.join(stage, name), path.join(directory, name)); replaced.push(name); }
  } catch (error) {
    const failures: unknown[] = [];
    for (const name of replaced.reverse()) try { await fileSystem.rename(path.join(backup, name), path.join(directory, name)); } catch (failure) { failures.push(failure); }
    if (failures.length) { manualRecoveryRequired = true; throw new ArtistsSaveError("Failed to roll back Artist Save", "artists-save-rollback-failed", { cause: new AggregateError([error, ...failures]) }); }
    if (error instanceof ArtistsSaveError) throw error;
    throw new ArtistsSaveError("Failed to save Artist", "save-failed", { cause: error });
  } finally {
    if (!manualRecoveryRequired) await Promise.all([fileSystem.rm(stage, { recursive: true, force: true }).catch(() => undefined), fileSystem.rm(backup, { recursive: true, force: true }).catch(() => undefined)]);
  }
}

export async function saveArtistsEditorDraft(draft: ArtistsEditorDraftState, baseline: ArtistsEditorDraftState, root = canonicalRoot, fileSystem: ArtistsSaveFileSystem = fs) {
  if (!validateArtistsEditorDraft(draft).capabilities.save) throw new ArtistsSaveError("Artist draft has blocking issues", "invalid-draft");
  if (draft.contentId !== baseline.contentId) throw new ArtistsSaveError("Content baseline mismatch", "canonical-mismatch");
  const entry = await readArtistsEditorEntry(draft.contentId, root);
  const canonical = createArtistsEditorDraft(entry);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline) || !entry.canonicalFiles) throw new ArtistsSaveError("Canonical Artist changed after load", "canonical-mismatch");
  await writeArtistsSerializedFiles(draft.contentId, serializeArtistsEditorDraft(draft), entry.canonicalFiles, root, fileSystem);
  const saved = createArtistsEditorDraft(await readArtistsEditorEntry(draft.contentId, root));
  if (!saved) throw new ArtistsSaveError("Saved Artist is invalid", "save-failed");
  return saved;
}

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export async function saveArtistsEditorDraftWithHero(
  draft: ArtistsEditorDraftState,
  baseline: ArtistsEditorDraftState,
  hero: ArtistsHeroAssetDraft,
  options: {
    root?: string;
    assetRoot?: string;
    store?: TemporaryArtistsHeroAssetStore;
    fileSystem?: ArtistsSaveFileSystem;
  } = {},
) {
  if (hero.kind !== "temporary")
    return saveArtistsEditorDraft(draft, baseline, options.root, options.fileSystem);
  if (!validateArtistsEditorDraft(draft).capabilities.save || draft.data.hero.image !== hero.proposedSrc)
    throw new ArtistsSaveError("Artist draft has invalid Hero state", "invalid-draft");
  if (draft.contentId !== baseline.contentId)
    throw new ArtistsSaveError("Content baseline mismatch", "canonical-mismatch");

  const root = path.resolve(options.root ?? canonicalRoot);
  const assetRoot = path.resolve(options.assetRoot ?? "public/images/artists");
  const store = options.store ?? (await temporaryArtistsHeroAssetStore);
  const fileSystem = options.fileSystem ?? fs;
  const entry = await readArtistsEditorEntry(draft.contentId, root);
  const canonical = createArtistsEditorDraft(entry);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline) || !entry.canonicalFiles)
    throw new ArtistsSaveError("Canonical Artist changed after load", "canonical-mismatch");

  let temporary;
  try {
    temporary = await store.read(hero.token, draft.contentId, hero.workspaceId);
  } catch (error) {
    if (error instanceof ArtistsHeroAssetError && ["asset-temp-not-found", "asset-temp-expired", "asset-temp-unsafe"].includes(error.code))
      throw new ArtistsSaveError(error.message, error.code as "asset-temp-not-found" | "asset-temp-expired" | "asset-temp-unsafe", { cause: error });
    throw error;
  }
  if (
    temporary.metadata.proposedSrc !== hero.proposedSrc ||
    temporary.metadata.sha256 !== hero.sha256 ||
    JSON.stringify(temporary.metadata.replaces) !== JSON.stringify(hero.replaces)
  ) throw new ArtistsSaveError("Temporary Hero metadata mismatch", "asset-temp-unsafe");
  const admitted = await inspectArtistsHeroCandidate({
    contentId: draft.contentId,
    declaredMime: temporary.metadata.mime,
    bytes: temporary.bytes,
  });
  if (admitted.proposedSrc !== hero.proposedSrc || admitted.sha256 !== hero.sha256)
    throw new ArtistsSaveError("Temporary Hero failed revalidation", "asset-temp-unsafe");

  const assetRootStat = await fileSystem.lstat(assetRoot).catch(() => undefined);
  if (!assetRootStat?.isDirectory() || assetRootStat.isSymbolicLink())
    throw new ArtistsSaveError("Artists asset root is unsafe", "asset-save-failed");
  const basename = hero.proposedSrc.slice(ARTISTS_HERO_PREFIX.length);
  const target = path.resolve(assetRoot, basename);
  if (!hero.proposedSrc.startsWith(ARTISTS_HERO_PREFIX) || path.dirname(target) !== assetRoot || path.basename(target) !== basename)
    throw new ArtistsSaveError("Artists Hero target is unsafe", "asset-save-failed");
  const targetStat = await fileSystem.lstat(target).catch(() => undefined);
  if (hero.replaces) {
    if (!targetStat?.isFile() || targetStat.isSymbolicLink() || hash(await fileSystem.readFile(target)) !== hero.replaces.sha256)
      throw new ArtistsSaveError("Canonical Hero changed before Save", "canonical-mismatch");
  } else if (targetStat) {
    throw new ArtistsSaveError("Canonical Hero target appeared before Save", "canonical-mismatch");
  }

  const directory = await directoryFor(draft.contentId, root, fileSystem);
  const next = serializeArtistsEditorDraft(draft);
  const id = `.artists-hero-save-${randomUUID()}`;
  const contentStage = path.join(directory, `${id}-stage`);
  const contentBackup = path.join(directory, `${id}-backup`);
  const assetStage = path.join(assetRoot, `${id}-${basename}`);
  const assetBackup = path.join(assetRoot, `${id}-backup-${basename}`);
  const installedContent: (typeof files)[number][] = [];
  let assetInstalled = false;
  let assetBackedUp = false;
  let recoveryRequired = false;
  try {
    await fileSystem.mkdir(contentStage);
    await fileSystem.mkdir(contentBackup);
    for (const name of files) {
      const current = await fileSystem.readFile(path.join(directory, name), "utf8");
      if (current !== entry.canonicalFiles[name]) throw new ArtistsSaveError("Canonical Artist changed during Save", "canonical-mismatch");
      await fileSystem.writeFile(path.join(contentStage, name), next[name], { encoding: "utf8", flag: "wx" });
      await fileSystem.writeFile(path.join(contentBackup, name), current, { encoding: "utf8", flag: "wx" });
    }
    await fileSystem.writeFile(assetStage, temporary.bytes, { flag: "wx" });
    const stagedBytes = await fileSystem.readFile(assetStage);
    if (hash(stagedBytes) !== hero.sha256) throw new Error("Staged Hero hash mismatch");
    await inspectArtistsHeroCandidate({ contentId: draft.contentId, declaredMime: temporary.metadata.mime, bytes: stagedBytes });
    if (hero.replaces) { await fileSystem.rename(target, assetBackup); assetBackedUp = true; }
    await fileSystem.rename(assetStage, target); assetInstalled = true;
    for (const name of files) {
      await fileSystem.rename(path.join(contentStage, name), path.join(directory, name));
      installedContent.push(name);
    }
    if (hash(await fileSystem.readFile(target)) !== hero.sha256) throw new Error("Installed Hero verification failed");
    for (const name of files)
      if ((await fileSystem.readFile(path.join(directory, name), "utf8")) !== next[name]) throw new Error("Installed Artist content verification failed");
    await store.release(hero.token, draft.contentId, hero.workspaceId);
  } catch (error) {
    const failures: unknown[] = [];
    for (const name of installedContent.reverse()) {
      try { await fileSystem.rename(path.join(contentBackup, name), path.join(directory, name)); }
      catch (failure) { failures.push(failure); }
    }
    if (assetInstalled) await fileSystem.rm(target, { force: true }).catch((failure) => failures.push(failure));
    if (assetBackedUp) await fileSystem.rename(assetBackup, target).catch((failure) => failures.push(failure));
    if (failures.length) {
      recoveryRequired = true;
      throw new ArtistsSaveError("Failed to roll back Artist Hero Save", "artists-save-rollback-failed", { cause: new AggregateError([error, ...failures]) });
    }
    if (error instanceof ArtistsSaveError) throw error;
    throw new ArtistsSaveError("Failed to save Artist Hero", "asset-save-failed", { cause: error });
  } finally {
    if (!recoveryRequired) await Promise.all([
      fileSystem.rm(contentStage, { recursive: true, force: true }).catch(() => undefined),
      fileSystem.rm(contentBackup, { recursive: true, force: true }).catch(() => undefined),
      fileSystem.rm(assetStage, { force: true }).catch(() => undefined),
      fileSystem.rm(assetBackup, { force: true }).catch(() => undefined),
    ]);
  }
  const saved = createArtistsEditorDraft(await readArtistsEditorEntry(draft.contentId, root));
  if (!saved) throw new ArtistsSaveError("Saved Artist is invalid", "save-failed");
  return saved;
}
