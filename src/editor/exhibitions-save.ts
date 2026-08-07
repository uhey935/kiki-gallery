import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import {
  createExhibitionsEditorDraft,
  validateExhibitionsEditorDraft,
  type ExhibitionsEditorDraftState,
} from "./exhibitions-draft-state.ts";
import { serializeExhibitionsEditorDraft } from "./exhibitions-serializer.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";

const canonicalRoot = path.resolve("src/content/exhibitions");
export class ExhibitionsSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "save-failed";
  constructor(
    message: string,
    code:
      | "invalid-content-id"
      | "invalid-draft"
      | "canonical-mismatch"
      | "save-failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}
export type ExhibitionsSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "readFile" | "rename" | "rm" | "writeFile"
>;
async function targetFor(
  contentId: string,
  root: string,
  fileSystem: ExhibitionsSaveFileSystem,
) {
  if (!isContentId(contentId))
    throw new ExhibitionsSaveError(
      "Invalid Exhibition Content ID",
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
    throw new ExhibitionsSaveError(
      "Unsafe Exhibition source",
      "invalid-content-id",
    );
  return target;
}
export async function saveExhibitionsEditorDraft(
  draft: ExhibitionsEditorDraftState,
  baseline: ExhibitionsEditorDraftState,
  root = canonicalRoot,
  fileSystem: ExhibitionsSaveFileSystem = fs,
) {
  if (!validateExhibitionsEditorDraft(draft).capabilities.save)
    throw new ExhibitionsSaveError(
      "Exhibition draft has blocking issues",
      "invalid-draft",
    );
  if (draft.contentId !== baseline.contentId)
    throw new ExhibitionsSaveError("Content ID mismatch", "canonical-mismatch");
  const canonicalEntry = await readExhibitionsEditorEntry(
    draft.contentId,
    root,
  );
  const canonical = createExhibitionsEditorDraft(canonicalEntry);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new ExhibitionsSaveError(
      "Canonical Exhibition changed after load",
      "canonical-mismatch",
    );
  const target = await targetFor(draft.contentId, root, fileSystem);
  const staged = path.join(
    root,
    `.exhibitions-save-${draft.contentId}-${randomUUID()}.tmp`,
  );
  const serialized = serializeExhibitionsEditorDraft(draft);
  try {
    await fileSystem.writeFile(staged, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
    const stat = await fileSystem.lstat(staged);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Unsafe staged source");
    if ((await fileSystem.readFile(target, "utf8")) !== canonicalEntry.raw)
      throw new ExhibitionsSaveError(
        "Canonical Exhibition changed during Save",
        "canonical-mismatch",
      );
    await fileSystem.rename(staged, target);
  } catch (error) {
    if (error instanceof ExhibitionsSaveError) throw error;
    throw new ExhibitionsSaveError("Failed to save Exhibition", "save-failed", {
      cause: error,
    });
  } finally {
    await fileSystem.rm(staged, { force: true }).catch(() => undefined);
  }
  const saved = createExhibitionsEditorDraft(
    await readExhibitionsEditorEntry(draft.contentId, root),
  );
  if (!saved)
    throw new ExhibitionsSaveError(
      "Saved Exhibition is invalid",
      "save-failed",
    );
  return saved;
}
