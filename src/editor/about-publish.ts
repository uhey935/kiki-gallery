import { execFile as callback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  createAboutEditorDraft,
  isAboutEditorDraftDirty,
  validateAboutEditorDraft,
  type AboutEditorDraftState,
} from "./about-draft-state.ts";
import { readAboutEditorEntry } from "./about-state.ts";
const execFile = promisify(callback);
export const ABOUT_PUBLISH_FILES = [
  "src/content/about/about/en.md",
  "src/content/about/about/index.yaml",
  "src/content/about/about/ja.md",
] as const;
type Git = (args: string[]) => Promise<string>;
export class AboutPublishError extends Error {
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
    code: AboutPublishError["code"],
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
export async function inspectAboutPublish(
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
    const separator = upstream.indexOf("/"),
      remote = upstream.slice(0, separator);
    if (separator < 1 || upstream.slice(separator + 1) !== branch)
      throw new Error("upstream mismatch");
    for (const file of ABOUT_PUBLISH_FILES) {
      const stat = await fs.lstat(path.join(repositoryRoot, file));
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("unsafe About file");
    }
    if (!(await git(["status", "--porcelain", "--", ...ABOUT_PUBLISH_FILES])))
      throw new AboutPublishError(
        "Canonical About has no changes",
        "nothing-to-publish",
      );
    return {
      branch,
      remote,
      files: [...ABOUT_PUBLISH_FILES],
      commitMessage: "Publish localized About",
    };
  } catch (error) {
    if (error instanceof AboutPublishError) throw error;
    throw new AboutPublishError(
      "Unsafe About repository",
      "unsafe-repository",
      { cause: error },
    );
  }
}
export async function publishSavedAboutEntry(
  draft: AboutEditorDraftState,
  baseline: AboutEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  root = path.join(repositoryRoot, "src/content/about"),
) {
  if (dirty || isAboutEditorDraftDirty(draft, baseline))
    throw new AboutPublishError("Save before publishing", "dirty-draft");
  if (!validateAboutEditorDraft(draft).capabilities.publish)
    throw new AboutPublishError(
      "About draft is structurally blocked",
      "publish-blocked",
    );
  const canonical = createAboutEditorDraft(await readAboutEditorEntry(root));
  if (JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new AboutPublishError(
      "Saved baseline does not match canonical About",
      "canonical-mismatch",
    );
  const git = createGit(repositoryRoot),
    inspection = await inspectAboutPublish(repositoryRoot, git);
  try {
    await git(["add", "--", ...inspection.files]);
    const staged = (
      await git(["diff", "--cached", "--name-only", "--no-renames"])
    )
      .split("\n")
      .filter(Boolean)
      .sort();
    if (
      !staged.length ||
      staged.some((file) => !inspection.files.includes(file as never))
    )
      throw new AboutPublishError(
        "Staging escaped About boundary",
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
        state: "committed-push-failed" as const,
        commit,
        branch: inspection.branch,
        remote: inspection.remote,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      state: "published" as const,
      commit,
      branch: inspection.branch,
      remote: inspection.remote,
    };
  } catch (error) {
    if (error instanceof AboutPublishError) throw error;
    throw new AboutPublishError("Failed to publish About", "publish-failed", {
      cause: error,
    });
  }
}
