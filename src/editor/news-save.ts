import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import {
  createNewsEditorDraft,
  validateNewsEditorDraft,
  type NewsEditorDraftState,
} from "./news-draft-state.ts";
import {
  serializeNewsEditorDraft,
  type NewsSerializedFiles,
} from "./news-serializer.ts";
import { readNewsEditorEntry } from "./news-state.ts";

const files = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/news");
export class NewsSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "news-save-rollback-failed"
    | "save-failed";
  constructor(
    message: string,
    code: NewsSaveError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NewsSaveError";
    this.code = code;
  }
}
export type NewsSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "rename" | "rm" | "writeFile"
>;

async function directoryFor(
  contentId: string,
  root: string,
  fileSystem: NewsSaveFileSystem,
) {
  if (!isContentId(contentId))
    throw new NewsSaveError("Invalid News Content ID", "invalid-content-id");
  const resolvedRoot = path.resolve(root);
  const directory = path.resolve(resolvedRoot, contentId);
  const stat = await fileSystem.lstat(directory).catch(() => undefined);
  if (
    path.dirname(directory) !== resolvedRoot ||
    !stat?.isDirectory() ||
    stat.isSymbolicLink()
  )
    throw new NewsSaveError("Unsafe News unit", "invalid-content-id");
  return directory;
}

export async function writeNewsSerializedFiles(
  contentId: string,
  next: NewsSerializedFiles,
  baseline: NewsSerializedFiles,
  root = canonicalRoot,
  fileSystem: NewsSaveFileSystem = fs,
) {
  const directory = await directoryFor(contentId, root, fileSystem);
  const id = `.news-save-${randomUUID()}`;
  const stage = path.join(directory, `${id}-stage`);
  const backup = path.join(directory, `${id}-backup`);
  const replaced: (typeof files)[number][] = [];
  let manualRecoveryRequired = false;
  try {
    await fileSystem.mkdir(stage);
    await fileSystem.mkdir(backup);
    for (const name of files) {
      const target = path.join(directory, name);
      const stat = await fileSystem.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`Unsafe News source: ${name}`);
      const current = await fileSystem.readFile(target, "utf8");
      if (current !== baseline[name])
        throw new NewsSaveError(
          "Canonical News changed during Save",
          "canonical-mismatch",
        );
      await fileSystem.writeFile(path.join(stage, name), next[name], {
        encoding: "utf8",
        flag: "wx",
      });
      await fileSystem.writeFile(path.join(backup, name), current, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    for (const name of files) {
      await fileSystem.rename(
        path.join(stage, name),
        path.join(directory, name),
      );
      replaced.push(name);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const name of replaced.reverse())
      try {
        await fileSystem.rename(
          path.join(backup, name),
          path.join(directory, name),
        );
      } catch (failure) {
        failures.push(failure);
      }
    if (failures.length) {
      manualRecoveryRequired = true;
      throw new NewsSaveError(
        "Failed to roll back News Save",
        "news-save-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof NewsSaveError) throw error;
    throw new NewsSaveError("Failed to save News", "save-failed", {
      cause: error,
    });
  } finally {
    if (!manualRecoveryRequired)
      await Promise.all([
        fileSystem
          .rm(stage, { recursive: true, force: true })
          .catch(() => undefined),
        fileSystem
          .rm(backup, { recursive: true, force: true })
          .catch(() => undefined),
      ]);
  }
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
    throw new NewsSaveError("Content baseline mismatch", "canonical-mismatch");
  const entry = await readNewsEditorEntry(draft.contentId, root);
  const canonical = createNewsEditorDraft(entry);
  if (
    !canonical ||
    JSON.stringify(canonical) !== JSON.stringify(baseline) ||
    !entry.canonicalFiles
  )
    throw new NewsSaveError(
      "Canonical News changed after load",
      "canonical-mismatch",
    );
  await writeNewsSerializedFiles(
    draft.contentId,
    serializeNewsEditorDraft(draft),
    entry.canonicalFiles,
    root,
    fileSystem,
  );
  const saved = createNewsEditorDraft(
    await readNewsEditorEntry(draft.contentId, root),
  );
  if (!saved) throw new NewsSaveError("Saved News is invalid", "save-failed");
  return saved;
}
