import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createHomeEditorDraft,
  validateHomeEditorDraft,
  type HomeEditorDraftState,
} from "./home-draft-state.ts";
import { serializeHomeEditorDraft } from "./home-serializer.ts";
import { readHomeEditorEntry } from "./home-state.ts";
const canonicalRoot = path.resolve("src/content/home");
export class HomeSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "save-failed";
  constructor(
    message: string,
    code: HomeSaveError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}
export type HomeSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "readFile" | "rename" | "rm" | "writeFile"
>;
export async function saveHomeEditorDraft(
  draft: HomeEditorDraftState,
  baseline: HomeEditorDraftState,
  root = canonicalRoot,
  fileSystem: HomeSaveFileSystem = fs,
) {
  if (draft.contentId !== "home" || baseline.contentId !== "home")
    throw new HomeSaveError("Invalid Home Content ID", "invalid-content-id");
  if (!validateHomeEditorDraft(draft).capabilities.save)
    throw new HomeSaveError("Home draft has blocking issues", "invalid-draft");
  const canonicalEntry = await readHomeEditorEntry(root);
  const canonical = createHomeEditorDraft(canonicalEntry);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new HomeSaveError(
      "Canonical Home changed after load",
      "canonical-mismatch",
    );
  const target = path.resolve(root, "home.md");
  const rootStat = await fileSystem.lstat(path.resolve(root));
  const targetStat = await fileSystem.lstat(target);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !targetStat.isFile() ||
    targetStat.isSymbolicLink() ||
    path.dirname(target) !== path.resolve(root)
  )
    throw new HomeSaveError("Unsafe Home source", "invalid-content-id");
  const staged = path.join(root, `.home-save-${randomUUID()}.tmp`);
  try {
    await fileSystem.writeFile(staged, serializeHomeEditorDraft(draft), {
      encoding: "utf8",
      flag: "wx",
    });
    const stat = await fileSystem.lstat(staged);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Unsafe staged source");
    if ((await fileSystem.readFile(target, "utf8")) !== canonicalEntry.raw)
      throw new HomeSaveError(
        "Canonical Home changed during Save",
        "canonical-mismatch",
      );
    await fileSystem.rename(staged, target);
  } catch (error) {
    if (error instanceof HomeSaveError) throw error;
    throw new HomeSaveError("Failed to save Home", "save-failed", {
      cause: error,
    });
  } finally {
    await fileSystem.rm(staged, { force: true }).catch(() => undefined);
  }
  const saved = createHomeEditorDraft(await readHomeEditorEntry(root));
  if (!saved) throw new HomeSaveError("Saved Home is invalid", "save-failed");
  return saved;
}
