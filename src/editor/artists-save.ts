import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import { createArtistsEditorDraft, validateArtistsEditorDraft, type ArtistsEditorDraftState } from "./artists-draft-state.ts";
import { serializeArtistsEditorDraft, type ArtistsSerializedFiles } from "./artists-serializer.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";

const files = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/artists");
export class ArtistsSaveError extends Error {
  readonly code: "invalid-content-id" | "invalid-draft" | "canonical-mismatch" | "artists-save-rollback-failed" | "save-failed";
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
