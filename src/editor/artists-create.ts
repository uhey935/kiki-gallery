import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadArtistUnit } from "../content-loaders/artists/repository.ts";
import { isContentId } from "./content-id.ts";
import { createArtistsEditorDraft, validateArtistsEditorDraft, type ArtistsEditorDraftState } from "./artists-draft-state.ts";
import { serializeArtistsEditorDraft } from "./artists-serializer.ts";
import { readArtistsEditorEntry, type ArtistsEditorEntryState } from "./artists-state.ts";

const names = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/artists");
export class ArtistsCreateError extends Error {
  readonly code: "invalid-content-id" | "invalid-draft" | "content-id-collision" | "unsafe-artists-root" | "canonical-mismatch" | "artists-create-rollback-failed" | "create-failed";
  constructor(message: string, code: ArtistsCreateError["code"], options?: ErrorOptions) { super(message, options); this.name = "ArtistsCreateError"; this.code = code; }
}
export type ArtistsCreateFileSystem = Pick<typeof fs, "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "rm" | "writeFile">;
export type ArtistsCreateReader = (contentId: string, root: string) => Promise<ArtistsEditorEntryState | undefined>;

async function absent(id: string, root: string, io: ArtistsCreateFileSystem) {
  if (!isContentId(id)) throw new ArtistsCreateError("Invalid Artist Content ID", "invalid-content-id");
  const resolved = path.resolve(root);
  const stat = await io.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new ArtistsCreateError("Unsafe Artists root", "unsafe-artists-root");
  const destination = path.resolve(resolved, id);
  if (path.dirname(destination) !== resolved) throw new ArtistsCreateError("Invalid Artist Content ID", "invalid-content-id");
  if ((await io.readdir(resolved)).some((name) => name.toLowerCase() === id.toLowerCase() || name.toLowerCase() === `${id}.md`.toLowerCase())) throw new ArtistsCreateError("Artist Content ID already exists", "content-id-collision");
  return destination;
}

export async function createArtistsThreeFileEntry(draft: ArtistsEditorDraftState, root = canonicalRoot, io: ArtistsCreateFileSystem = fs, reread: ArtistsCreateReader = readArtistsEditorEntry) {
  if (!validateArtistsEditorDraft(draft).capabilities.save) throw new ArtistsCreateError("Artist draft has blocking issues", "invalid-draft");
  const destination = await absent(draft.contentId, root, io);
  const output = serializeArtistsEditorDraft(draft);
  const stageRoot = path.join(path.resolve(root), `.artists-create-${randomUUID()}`);
  const stage = path.join(stageRoot, draft.contentId);
  let committed = false;
  try {
    await io.mkdir(stageRoot); await io.mkdir(stage);
    for (const name of names) await io.writeFile(path.join(stage, name), output[name], { encoding: "utf8", flag: "wx" });
    const unit = await loadArtistUnit(stage);
    if (unit.identity.state !== "valid" || unit.locales.ja.state !== "valid" || unit.locales.en.state !== "valid") throw new ArtistsCreateError("Serialized Artist failed validation", "canonical-mismatch");
    await absent(draft.contentId, root, io);
    await io.rename(stage, destination); committed = true;
    const entry = await reread(draft.contentId, root);
    const saved = entry ? createArtistsEditorDraft(entry) : undefined;
    if (!saved) throw new ArtistsCreateError("Created Artist failed reread", "canonical-mismatch");
    return saved;
  } catch (error) {
    if (committed) try {
      for (const name of names) if ((await io.readFile(path.join(destination, name), "utf8")) !== output[name]) throw new Error("created bytes changed");
      await io.rm(destination, { recursive: true, force: false });
    } catch (rollback) { throw new ArtistsCreateError("Failed to roll back Artist Create", "artists-create-rollback-failed", { cause: new AggregateError([error, rollback]) }); }
    if (error instanceof ArtistsCreateError) throw error;
    throw new ArtistsCreateError("Failed to create Artist", "create-failed", { cause: error });
  } finally { await io.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined); }
}
