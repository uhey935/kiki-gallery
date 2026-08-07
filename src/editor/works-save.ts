import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isContentId } from "./content-id.ts";
import {
  createWorksEditorDraft,
  validateWorksEditorDraft,
  type WorksEditorDraftState,
} from "./works-draft-state.ts";
import { serializeWorksEditorDraft } from "./works-serializer.ts";
import { readWorksEditorEntry } from "./works-state.ts";

const canonicalWorksRoot = path.resolve("src/content/works");

export class WorksSaveError extends Error {
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
    this.name = "WorksSaveError";
    this.code = code;
  }
}

export type WorksSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "readFile" | "rename" | "rm" | "writeFile"
>;

async function resolveTarget(
  contentId: string,
  root: string,
  fileSystem: WorksSaveFileSystem,
): Promise<string> {
  if (!isContentId(contentId))
    throw new WorksSaveError(
      `Invalid Works Content ID: ${contentId}`,
      "invalid-content-id",
    );
  const resolvedRoot = path.resolve(root);
  const rootStat = await fileSystem.lstat(resolvedRoot).catch(() => undefined);
  const target = path.resolve(resolvedRoot, `${contentId}.md`);
  const targetStat = await fileSystem.lstat(target).catch(() => undefined);
  if (
    path.dirname(target) !== resolvedRoot ||
    !rootStat?.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !targetStat?.isFile() ||
    targetStat.isSymbolicLink()
  )
    throw new WorksSaveError(
      `Unsafe Works source: ${contentId}`,
      "invalid-content-id",
    );
  return target;
}

export async function writeWorksSerializedFile(
  contentId: string,
  serialized: string,
  baselineRaw: string,
  root = canonicalWorksRoot,
  fileSystem: WorksSaveFileSystem = fs,
): Promise<void> {
  const target = await resolveTarget(contentId, root, fileSystem);
  const staged = path.join(
    path.dirname(target),
    `.works-save-${contentId}-${randomUUID()}.tmp`,
  );
  try {
    await fileSystem.writeFile(staged, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
    const stagedStat = await fileSystem.lstat(staged);
    if (!stagedStat.isFile() || stagedStat.isSymbolicLink())
      throw new Error("Staged Works source is not a regular file");
    if ((await fileSystem.readFile(target, "utf8")) !== baselineRaw)
      throw new WorksSaveError(
        "Canonical Works file changed while Save was preparing replacement",
        "canonical-mismatch",
      );
    await fileSystem.rename(staged, target);
  } catch (error) {
    if (error instanceof WorksSaveError) throw error;
    throw new WorksSaveError(
      `Failed to save Works entry: ${contentId}`,
      "save-failed",
      { cause: error },
    );
  } finally {
    await fileSystem.rm(staged, { force: true }).catch(() => undefined);
  }
}

export async function saveWorksEditorDraft(
  draft: WorksEditorDraftState,
  baseline: WorksEditorDraftState,
  root = canonicalWorksRoot,
  fileSystem: WorksSaveFileSystem = fs,
): Promise<WorksEditorDraftState> {
  if (!isContentId(draft.contentId))
    throw new WorksSaveError(
      `Invalid Works Content ID: ${draft.contentId}`,
      "invalid-content-id",
    );
  if (!validateWorksEditorDraft(draft).capabilities.save)
    throw new WorksSaveError(
      "Works draft has blocking validation issues",
      "invalid-draft",
    );
  if (draft.contentId !== baseline.contentId)
    throw new WorksSaveError(
      "Works draft and baseline Content IDs do not match",
      "canonical-mismatch",
    );
  const canonicalEntry = await readWorksEditorEntry(draft.contentId, root);
  const canonical = createWorksEditorDraft(canonicalEntry);
  if (!canonical || JSON.stringify(baseline) !== JSON.stringify(canonical))
    throw new WorksSaveError(
      "Canonical Works file changed after the Editor baseline was loaded",
      "canonical-mismatch",
    );
  await writeWorksSerializedFile(
    draft.contentId,
    serializeWorksEditorDraft(draft),
    canonicalEntry.raw,
    root,
    fileSystem,
  );
  const saved = createWorksEditorDraft(
    await readWorksEditorEntry(draft.contentId, root),
  );
  if (!saved)
    throw new WorksSaveError("Saved Works source is invalid", "save-failed");
  return saved;
}
