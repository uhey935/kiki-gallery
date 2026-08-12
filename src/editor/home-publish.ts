import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  createHomeEditorDraft,
  isHomeEditorDraftDirty,
  validateHomeEditorDraft,
  type HomeEditorDraftState,
} from "./home-draft-state.ts";
import { readHomeEditorEntry } from "./home-state.ts";
const execFile = promisify(execFileCallback);
const files = [
  "src/content/home/home/en.md",
  "src/content/home/home/index.yaml",
  "src/content/home/home/ja.md",
] as const;
type Git = (args: string[]) => Promise<string>;
export type HomePublishResult =
  | { state: "published"; commit: string; branch: string; remote: string }
  | {
      state: "committed-push-failed";
      commit: string;
      branch: string;
      remote: string;
      error: string;
    };
export class HomePublishError extends Error {
  readonly code:
    | "dirty-draft"
    | "publish-blocked"
    | "canonical-mismatch"
    | "unsafe-repository"
    | "publish-set-mismatch"
    | "nothing-to-publish"
    | "publish-failed";
  constructor(
    message: string,
    code: HomePublishError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}
const createGit =
  (root: string): Git =>
  async (args) =>
    (
      await execFile("git", args, { cwd: root, encoding: "utf8" })
    ).stdout.trim();
export async function inspectHomePublish(
  repositoryRoot = path.resolve("."),
  git = createGit(repositoryRoot),
) {
  try {
    if (await git(["diff", "--cached", "--name-only", "-z"]))
      throw new Error("staged changes exist");
    const branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const upstream = await git([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const separator = upstream.indexOf("/");
    const remote = upstream.slice(0, separator);
    if (separator < 1 || upstream.slice(separator + 1) !== branch)
      throw new Error("upstream mismatch");
    for (const file of files) {
      const stat = await fs.lstat(path.join(repositoryRoot, file));
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("unsafe Home file");
    }
    if (!(await git(["status", "--porcelain", "--", ...files])))
      throw new HomePublishError(
        "Canonical Home has no changes",
        "nothing-to-publish",
      );
    return {
      branch,
      remote,
      files: [...files],
      commitMessage: "Publish localized Home",
    };
  } catch (error) {
    if (error instanceof HomePublishError) throw error;
    throw new HomePublishError("Unsafe Home repository", "unsafe-repository", {
      cause: error,
    });
  }
}
export async function publishSavedHomeEntry(
  draft: HomeEditorDraftState,
  baseline: HomeEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  root = path.join(repositoryRoot, "src/content/home"),
): Promise<HomePublishResult> {
  if (dirty || isHomeEditorDraftDirty(draft, baseline))
    throw new HomePublishError("Save before publishing", "dirty-draft");
  if (!validateHomeEditorDraft(draft).capabilities.publish)
    throw new HomePublishError(
      "Home draft is structurally blocked",
      "publish-blocked",
    );
  const canonical = createHomeEditorDraft(await readHomeEditorEntry(root));
  if (JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new HomePublishError(
      "Saved baseline does not match canonical Home",
      "canonical-mismatch",
    );
  const git = createGit(repositoryRoot);
  const inspection = await inspectHomePublish(repositoryRoot, git);
  try {
    await git(["add", "--", ...inspection.files]);
    const staged = (
      await git(["diff", "--cached", "--name-only", "--no-renames"])
    )
      .split("\n")
      .filter(Boolean)
      .sort();
    if (
      staged.length === 0 ||
      staged.some((file) => !inspection.files.includes(file as (typeof files)[number]))
    )
      throw new HomePublishError(
        "Staging escaped Home boundary",
        "publish-set-mismatch",
      );
    await git([
      "commit",
      "-m",
      inspection.commitMessage,
      "--",
      ...inspection.files,
    ]);
    const commit = await git(["rev-parse", "HEAD"]);
    try {
      await git(["push", inspection.remote, inspection.branch]);
    } catch (error) {
      return {
        state: "committed-push-failed",
        commit,
        branch: inspection.branch,
        remote: inspection.remote,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      state: "published",
      commit,
      branch: inspection.branch,
      remote: inspection.remote,
    };
  } catch (error) {
    if (error instanceof HomePublishError) throw error;
    throw new HomePublishError("Failed to publish Home", "publish-failed", {
      cause: error,
    });
  }
}
