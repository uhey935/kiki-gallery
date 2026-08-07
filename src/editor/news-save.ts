import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import {
  createNewsEditorDraft,
  validateNewsEditorDraft,
  type NewsEditorDraftState,
} from "./news-draft-state.ts";
import { serializeNewsEditorDraft } from "./news-serializer.ts";
import { readNewsEditorEntry } from "./news-state.ts";
const canonicalRoot = path.resolve("src/content/news");
export class NewsSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "save-failed";
  constructor(
    message: string,
    code: NewsSaveError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}
export type NewsSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "readFile" | "rename" | "rm" | "writeFile"
>;
async function targetFor(
  contentId: string,
  root: string,
  fileSystem: NewsSaveFileSystem,
) {
  if (!isContentId(contentId))
    throw new NewsSaveError("Invalid News Content ID", "invalid-content-id");
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
    throw new NewsSaveError("Unsafe News source", "invalid-content-id");
  return target;
}
export async function saveNewsEditorDraft(
  draft: NewsEditorDraftState,
  baseline: NewsEditorDraftState,
  root = canonicalRoot,
  fileSystem: NewsSaveFileSystem = fs,
) {
  if (!validateNewsEditorDraft(draft).capabilities.save)
    throw new NewsSaveError("News draft has blocking issues", "invalid-draft");
  if (draft.contentId !== baseline.contentId)
    throw new NewsSaveError("Content ID mismatch", "canonical-mismatch");
  const canonicalEntry = await readNewsEditorEntry(draft.contentId, root);
  const canonical = createNewsEditorDraft(canonicalEntry);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new NewsSaveError(
      "Canonical News changed after load",
      "canonical-mismatch",
    );
  const target = await targetFor(draft.contentId, root, fileSystem);
  const staged = path.join(
    root,
    `.news-save-${draft.contentId}-${randomUUID()}.tmp`,
  );
  try {
    await fileSystem.writeFile(staged, serializeNewsEditorDraft(draft), {
      encoding: "utf8",
      flag: "wx",
    });
    const stat = await fileSystem.lstat(staged);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Unsafe staged source");
    if ((await fileSystem.readFile(target, "utf8")) !== canonicalEntry.raw)
      throw new NewsSaveError(
        "Canonical News changed during Save",
        "canonical-mismatch",
      );
    await fileSystem.rename(staged, target);
  } catch (error) {
    if (error instanceof NewsSaveError) throw error;
    throw new NewsSaveError("Failed to save News", "save-failed", {
      cause: error,
    });
  } finally {
    await fileSystem.rm(staged, { force: true }).catch(() => undefined);
  }
  const saved = createNewsEditorDraft(
    await readNewsEditorEntry(draft.contentId, root),
  );
  if (!saved) throw new NewsSaveError("Saved News is invalid", "save-failed");
  return saved;
}
