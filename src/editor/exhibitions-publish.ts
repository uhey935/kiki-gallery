import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { isContentId } from "./content-id.ts";
import {
  createExhibitionsEditorDraft,
  validateExhibitionsEditorDraft,
  type ExhibitionsEditorDraftState,
} from "./exhibitions-draft-state.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
const execFile = promisify(execFileCallback);
type Git = (args: string[]) => Promise<string>;
export type ExhibitionsPublishResult =
  | { state: "published"; commit: string; branch: string; remote: string }
  | {
      state: "committed-push-failed";
      commit: string;
      branch: string;
      remote: string;
      error: string;
    };
export class ExhibitionsPublishError extends Error {
  readonly code:
    | "dirty-draft"
    | "publish-blocked"
    | "canonical-mismatch"
    | "unsafe-repository"
    | "nothing-to-publish"
    | "publish-failed";
  constructor(
    message: string,
    code:
      | "dirty-draft"
      | "publish-blocked"
      | "canonical-mismatch"
      | "unsafe-repository"
      | "nothing-to-publish"
      | "publish-failed",
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
export const exhibitionsPublishCommitMessage = (contentId: string) =>
  `Publish exhibition: ${contentId}`;
async function context(git: Git, expectedRoot: string) {
  try {
    if (
      (await fs.realpath(await git(["rev-parse", "--show-toplevel"]))) !==
      (await fs.realpath(expectedRoot))
    )
      throw new Error("root mismatch");
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
    await git(["remote", "get-url", remote]);
    return { branch, remote };
  } catch (error) {
    throw new ExhibitionsPublishError(
      "Repository requires a matching branch upstream",
      "unsafe-repository",
      { cause: error },
    );
  }
}
export async function inspectExhibitionsPublish(
  contentId: string,
  repositoryRoot = path.resolve("."),
  git = createGit(repositoryRoot),
) {
  if (!isContentId(contentId))
    throw new ExhibitionsPublishError(
      "Invalid Exhibition Content ID",
      "unsafe-repository",
    );
  const repositoryContext = await context(git, repositoryRoot);
  if ((await git(["diff", "--cached", "--name-only", "-z"])).length)
    throw new ExhibitionsPublishError(
      "Repository already has staged changes",
      "unsafe-repository",
    );
  const file = path.posix.join("src/content/exhibitions", `${contentId}.md`);
  const stat = await fs
    .lstat(path.join(repositoryRoot, file))
    .catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new ExhibitionsPublishError(
      "Unsafe Exhibition source",
      "unsafe-repository",
    );
  if (!(await git(["status", "--porcelain", "--", file])))
    throw new ExhibitionsPublishError(
      "Canonical Exhibition has no changes",
      "nothing-to-publish",
    );
  return {
    ...repositoryContext,
    file,
    commitMessage: exhibitionsPublishCommitMessage(contentId),
  };
}
export async function publishSavedExhibitionsEntry(
  draft: ExhibitionsEditorDraftState,
  baseline: ExhibitionsEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  root = path.join(repositoryRoot, "src/content/exhibitions"),
): Promise<ExhibitionsPublishResult> {
  if (dirty || JSON.stringify(draft) !== JSON.stringify(baseline))
    throw new ExhibitionsPublishError("Save before publishing", "dirty-draft");
  if (!validateExhibitionsEditorDraft(draft).capabilities.publish)
    throw new ExhibitionsPublishError(
      "Exhibition is blocked from publishing",
      "publish-blocked",
    );
  const canonical = createExhibitionsEditorDraft(
    await readExhibitionsEditorEntry(draft.contentId, root),
  );
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new ExhibitionsPublishError(
      "Saved baseline does not match canonical Exhibition",
      "canonical-mismatch",
    );
  const git = createGit(repositoryRoot);
  const inspection = await inspectExhibitionsPublish(
    draft.contentId,
    repositoryRoot,
    git,
  );
  try {
    await git(["add", "--", inspection.file]);
    if ((await git(["diff", "--cached", "--name-only"])) !== inspection.file)
      throw new ExhibitionsPublishError(
        "Staging escaped Exhibition boundary",
        "unsafe-repository",
      );
    const staged = (
      await execFile("git", ["show", `:${inspection.file}`], {
        cwd: repositoryRoot,
        encoding: "utf8",
      })
    ).stdout;
    if (staged !== canonical.sourceRaw)
      throw new ExhibitionsPublishError(
        "Canonical Exhibition changed during Publish",
        "canonical-mismatch",
      );
    await git(["commit", "-m", inspection.commitMessage]);
  } catch (error) {
    await git(["reset", "--", inspection.file]).catch(() => undefined);
    if (error instanceof ExhibitionsPublishError) throw error;
    throw new ExhibitionsPublishError(
      "Failed to commit Exhibition",
      "publish-failed",
      { cause: error },
    );
  }
  const commit = await git(["rev-parse", "HEAD"]);
  try {
    await git(["push", inspection.remote, `HEAD:${inspection.branch}`]);
    return {
      state: "published",
      commit,
      branch: inspection.branch,
      remote: inspection.remote,
    };
  } catch (error) {
    return {
      state: "committed-push-failed",
      commit,
      branch: inspection.branch,
      remote: inspection.remote,
      error: error instanceof Error ? error.message : "Git push failed",
    };
  }
}
