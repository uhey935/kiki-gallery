import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { isContentId } from "./content-id.ts";
import {
  createWorksEditorDraft,
  validateWorksEditorDraft,
  type WorksEditorDraftState,
} from "./works-draft-state.ts";
import { readWorksEditorEntry } from "./works-state.ts";

const execFile = promisify(execFileCallback);

export type WorksPublishResult =
  | { state: "published"; commit: string; branch: string; remote: string }
  | {
      state: "committed-push-failed";
      commit: string;
      branch: string;
      remote: string;
      error: string;
    };

export type WorksPublishInspection = {
  branch: string;
  remote: string;
  file: string;
  diff: string;
  commitMessage: string;
};

export class WorksPublishError extends Error {
  readonly code:
    | "dirty-draft"
    | "publish-blocked"
    | "canonical-mismatch"
    | "unsafe-repository"
    | "nothing-to-publish"
    | "publish-failed";

  constructor(
    message: string,
    code: WorksPublishError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorksPublishError";
    this.code = code;
  }
}

type Git = (args: string[]) => Promise<string>;

function createGit(repositoryRoot: string): Git {
  return async (args) => {
    const { stdout } = await execFile("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    return stdout.trim();
  };
}

function pathFor(contentId: string): string {
  return path.posix.join("src/content/works", `${contentId}.md`);
}

export function worksPublishCommitMessage(contentId: string): string {
  return `Publish work: ${contentId}`;
}

async function repositoryContext(git: Git, expectedRoot: string) {
  try {
    const root = await fs.realpath(await git(["rev-parse", "--show-toplevel"]));
    if (root !== (await fs.realpath(expectedRoot)))
      throw new Error("root mismatch");
    const branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const upstream = await git([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const separator = upstream.indexOf("/");
    if (separator < 1) throw new Error("invalid upstream");
    const remote = upstream.slice(0, separator);
    const upstreamBranch = upstream.slice(separator + 1);
    if (upstreamBranch !== branch) throw new Error("branch mismatch");
    await git(["remote", "get-url", remote]);
    return { branch, remote };
  } catch (error) {
    throw new WorksPublishError(
      "Repository must be on a branch with a matching configured upstream",
      "unsafe-repository",
      { cause: error },
    );
  }
}

export async function inspectWorksPublish(
  contentId: string,
  repositoryRoot = path.resolve("."),
  git = createGit(repositoryRoot),
): Promise<WorksPublishInspection> {
  if (!isContentId(contentId))
    throw new WorksPublishError(
      `Invalid Works Content ID: ${contentId}`,
      "unsafe-repository",
    );
  const context = await repositoryContext(git, repositoryRoot);
  if ((await git(["diff", "--cached", "--name-only", "-z"])).length > 0)
    throw new WorksPublishError(
      "Publish refused because the repository already has staged changes",
      "unsafe-repository",
    );
  const file = pathFor(contentId);
  const stat = await fs
    .lstat(path.join(repositoryRoot, file))
    .catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new WorksPublishError(
      `Publish source is not a regular file: ${file}`,
      "unsafe-repository",
    );
  if (!(await git(["diff", "--name-only", "--", file])))
    throw new WorksPublishError(
      "Canonical Works entry has no changes to publish",
      "nothing-to-publish",
    );
  return {
    ...context,
    file,
    diff: await git(["diff", "--", file]),
    commitMessage: worksPublishCommitMessage(contentId),
  };
}

export async function publishSavedWorksEntry(
  draft: WorksEditorDraftState,
  baseline: WorksEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  worksRoot = path.join(repositoryRoot, "src/content/works"),
): Promise<WorksPublishResult> {
  if (dirty || JSON.stringify(draft) !== JSON.stringify(baseline))
    throw new WorksPublishError(
      "Save the draft before publishing",
      "dirty-draft",
    );
  if (!validateWorksEditorDraft(draft).capabilities.publish)
    throw new WorksPublishError(
      "Works entry is blocked from publishing",
      "publish-blocked",
    );
  const canonical = createWorksEditorDraft(
    await readWorksEditorEntry(draft.contentId, worksRoot),
  );
  if (!canonical || JSON.stringify(baseline) !== JSON.stringify(canonical))
    throw new WorksPublishError(
      "Saved Works baseline does not match the reread canonical file",
      "canonical-mismatch",
    );

  const git = createGit(repositoryRoot);
  const inspection = await inspectWorksPublish(
    draft.contentId,
    repositoryRoot,
    git,
  );
  const expected = canonical.sourceRaw;
  try {
    await git(["add", "--", inspection.file]);
    const staged = (await git(["diff", "--cached", "--name-only"]))
      .split("\n")
      .filter(Boolean);
    if (staged.length !== 1 || staged[0] !== inspection.file)
      throw new WorksPublishError(
        "Staged files escaped the Works publish boundary",
        "unsafe-repository",
      );
    const { stdout: stagedContent } = await execFile(
      "git",
      ["show", `:${inspection.file}`],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    if (stagedContent !== expected)
      throw new WorksPublishError(
        "Canonical Works file changed while Publish was staging it",
        "canonical-mismatch",
      );
    await git(["commit", "-m", inspection.commitMessage]);
  } catch (error) {
    await git(["reset", "--", inspection.file]).catch(() => undefined);
    if (error instanceof WorksPublishError) throw error;
    throw new WorksPublishError(
      "Failed to commit Works entry",
      "publish-failed",
      {
        cause: error,
      },
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
