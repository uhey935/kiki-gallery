import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import {
  createArtistsEditorDraft,
  validateArtistsEditorDraft,
  type ArtistsEditorDraftState,
} from "./artists-draft-state.ts";
import { serializeArtistsEditorDraft } from "./artists-serializer.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
const canonicalRoot = path.resolve("src/content/artists");
export class ArtistsSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "save-failed";
  constructor(
    message: string,
    code: ArtistsSaveError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}
export type ArtistsSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "readFile" | "rename" | "rm" | "writeFile"
>;
async function targetFor(
  contentId: string,
  root: string,
  fileSystem: ArtistsSaveFileSystem,
) {
  if (!isContentId(contentId))
    throw new ArtistsSaveError(
      "Invalid Artist Content ID",
      "invalid-content-id",
    );
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, `${contentId}.md`);
  const [rootStat, targetStat] = await Promise.all([
    fileSystem.lstat(resolvedRoot).catch(() => undefined),
    fileSystem.lstat(target).catch(() => undefined),
  ]);
  if (
    path.dirname(target) !== resolvedRoot ||
    !rootStat?.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !targetStat?.isFile() ||
    targetStat.isSymbolicLink()
  )
    throw new ArtistsSaveError("Unsafe Artist source", "invalid-content-id");
  return target;
}
export async function saveArtistsEditorDraft(
  draft: ArtistsEditorDraftState,
  baseline: ArtistsEditorDraftState,
  root = canonicalRoot,
  fileSystem: ArtistsSaveFileSystem = fs,
) {
  if (!validateArtistsEditorDraft(draft).capabilities.save)
    throw new ArtistsSaveError(
      "Artist draft has blocking issues",
      "invalid-draft",
    );
  if (draft.contentId !== baseline.contentId)
    throw new ArtistsSaveError("Content ID mismatch", "canonical-mismatch");
  const canonicalEntry = await readArtistsEditorEntry(draft.contentId, root);
  const canonical = createArtistsEditorDraft(canonicalEntry);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new ArtistsSaveError(
      "Canonical Artist changed after load",
      "canonical-mismatch",
    );
  const target = await targetFor(draft.contentId, root, fileSystem);
  const staged = path.join(
    root,
    `.artists-save-${draft.contentId}-${randomUUID()}.tmp`,
  );
  try {
    await fileSystem.writeFile(staged, serializeArtistsEditorDraft(draft), {
      encoding: "utf8",
      flag: "wx",
    });
    const stat = await fileSystem.lstat(staged);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Unsafe staged source");
    if ((await fileSystem.readFile(target, "utf8")) !== canonicalEntry.raw)
      throw new ArtistsSaveError(
        "Canonical Artist changed during Save",
        "canonical-mismatch",
      );
    await fileSystem.rename(staged, target);
  } catch (error) {
    if (error instanceof ArtistsSaveError) throw error;
    throw new ArtistsSaveError("Failed to save Artist", "save-failed", {
      cause: error,
    });
  } finally {
    await fileSystem.rm(staged, { force: true }).catch(() => undefined);
  }
  const saved = createArtistsEditorDraft(
    await readArtistsEditorEntry(draft.contentId, root),
  );
  if (!saved)
    throw new ArtistsSaveError("Saved Artist is invalid", "save-failed");
  return saved;
}
