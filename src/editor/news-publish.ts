import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { isContentId } from "./content-id.ts";
import {
  createNewsEditorDraft,
  validateNewsEditorDraft,
  type NewsEditorDraftState,
} from "./news-draft-state.ts";
import { readNewsEditorEntry } from "./news-state.ts";
const execFile = promisify(execFileCallback);
type Git = (args: string[]) => Promise<string>;
export type NewsPublishResult =
  | { state: "published"; commit: string; branch: string; remote: string }
  | {
      state: "committed-push-failed";
      commit: string;
      branch: string;
      remote: string;
      error: string;
    };
export class NewsPublishError extends Error {
  readonly code:
    | "dirty-draft"
    | "publish-blocked"
    | "canonical-mismatch"
    | "unsafe-repository"
    | "nothing-to-publish"
    | "publish-failed";
  constructor(
    message: string,
    code: NewsPublishError["code"],
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
    throw new NewsPublishError(
      "Repository requires a matching branch upstream",
      "unsafe-repository",
      { cause: error },
    );
  }
}
export async function inspectNewsPublish(
  contentId: string,
  repositoryRoot = path.resolve("."),
  git = createGit(repositoryRoot),
) {
  if (!isContentId(contentId))
    throw new NewsPublishError("Invalid News Content ID", "unsafe-repository");
  const repositoryContext = await context(git, repositoryRoot);
  if ((await git(["diff", "--cached", "--name-only", "-z"])).length)
    throw new NewsPublishError(
      "Repository already has staged changes",
      "unsafe-repository",
    );
  const file = path.posix.join("src/content/news", `${contentId}.md`);
  const stat = await fs
    .lstat(path.join(repositoryRoot, file))
    .catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new NewsPublishError("Unsafe News source", "unsafe-repository");
  if (!(await git(["status", "--porcelain", "--", file])))
    throw new NewsPublishError(
      "Canonical News has no changes",
      "nothing-to-publish",
    );
  return {
    ...repositoryContext,
    file,
    commitMessage: `Publish news: ${contentId}`,
  };
}
export async function publishSavedNewsEntry(
  draft: NewsEditorDraftState,
  baseline: NewsEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  root = path.join(repositoryRoot, "src/content/news"),
): Promise<NewsPublishResult> {
  if (dirty || JSON.stringify(draft) !== JSON.stringify(baseline))
    throw new NewsPublishError("Save before publishing", "dirty-draft");
  if (!validateNewsEditorDraft(draft).capabilities.publish)
    throw new NewsPublishError(
      "News is blocked from publishing",
      "publish-blocked",
    );
  const canonical = createNewsEditorDraft(
    await readNewsEditorEntry(draft.contentId, root),
  );
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new NewsPublishError(
      "Saved baseline does not match canonical News",
      "canonical-mismatch",
    );
  const git = createGit(repositoryRoot);
  const inspection = await inspectNewsPublish(
    draft.contentId,
    repositoryRoot,
    git,
  );
  try {
    await git(["add", "--", inspection.file]);
    if ((await git(["diff", "--cached", "--name-only"])) !== inspection.file)
      throw new NewsPublishError(
        "Staging escaped News boundary",
        "unsafe-repository",
      );
    const staged = (
      await execFile("git", ["show", `:${inspection.file}`], {
        cwd: repositoryRoot,
        encoding: "utf8",
      })
    ).stdout;
    if (staged !== canonical.sourceRaw)
      throw new NewsPublishError(
        "Canonical News changed during Publish",
        "canonical-mismatch",
      );
    await git(["commit", "-m", inspection.commitMessage]);
  } catch (error) {
    await git(["reset", "--", inspection.file]).catch(() => undefined);
    if (error instanceof NewsPublishError) throw error;
    throw new NewsPublishError("Failed to commit News", "publish-failed", {
      cause: error,
    });
  }
  const commit = await git(["rev-parse", "HEAD"]);
  const { branch, remote } = inspection;
  try {
    await git(["push", remote, `HEAD:${branch}`]);
    return { state: "published", commit, branch, remote };
  } catch (error) {
    return {
      state: "committed-push-failed",
      commit,
      branch,
      remote,
      error: error instanceof Error ? error.message : "Push failed",
    };
  }
}
