import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { isContentId } from "./content-id.ts";
import type { JournalEditorDraftState } from "./journal-draft-state.ts";
import {
  createJournalEditorDraft,
  validateJournalEditorDraft,
} from "./journal-draft-state.ts";
import { readJournalEditorEntry } from "./journal-state.ts";

const execFile = promisify(execFileCallback);
const fileNames = ["index.yaml", "ja.md", "en.md"] as const;

export type JournalPublishResult =
  | { state: "published"; commit: string; branch: string; remote: string }
  | {
      state: "committed-push-failed";
      commit: string;
      branch: string;
      remote: string;
      error: string;
    };

export type JournalPublishInspection = {
  branch: string;
  remote: string;
  files: string[];
  diff: string;
  commitMessage: string;
};

export class JournalPublishError extends Error {
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
    this.name = "JournalPublishError";
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

function pathsFor(contentId: string) {
  return fileNames.map((fileName) =>
    path.posix.join("src/content/journal", contentId, fileName),
  );
}

async function pathsForPendingRename(
  contentId: string,
  repositoryRoot: string,
  git: Git,
) {
  const destinationFiles = pathsFor(contentId);
  const destinationBytes = await Promise.all(
    destinationFiles.map((file) =>
      fs.readFile(path.join(repositoryRoot, file)),
    ),
  );
  const deleted = (
    await git([
      "diff",
      "--name-only",
      "--diff-filter=D",
      "--",
      "src/content/journal",
    ])
  )
    .split("\n")
    .filter(Boolean);
  const directories = [
    ...new Set(deleted.map((file) => path.posix.dirname(file))),
  ];
  const matches: string[][] = [];
  for (const directory of directories) {
    const candidates = fileNames.map((fileName) =>
      path.posix.join(directory, fileName),
    );
    if (!candidates.every((file) => deleted.includes(file))) continue;
    const oldBytes = await Promise.all(
      candidates.map((file) =>
        execFile("git", ["show", `HEAD:${file}`], {
          cwd: repositoryRoot,
          encoding: "utf8",
        })
          .then(({ stdout }) => stdout)
          .catch(() => ""),
      ),
    );
    if (
      oldBytes.every(
        (bytes, index) => bytes === destinationBytes[index].toString("utf8"),
      )
    )
      matches.push(candidates);
  }
  if (matches.length > 1)
    throw new JournalPublishError(
      "Publish found more than one possible Journal Rename source",
      "unsafe-repository",
    );
  return [...(matches[0] ?? []), ...destinationFiles];
}

export function journalPublishCommitMessage(contentId: string): string {
  return `Publish journal: ${contentId}`;
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
    throw new JournalPublishError(
      "Repository must be on a branch with a matching configured upstream",
      "unsafe-repository",
      { cause: error },
    );
  }
}

export async function inspectJournalPublish(
  contentId: string,
  repositoryRoot = path.resolve("."),
  git = createGit(repositoryRoot),
): Promise<JournalPublishInspection> {
  if (!isContentId(contentId)) {
    throw new JournalPublishError(
      `Invalid Journal Content ID: ${contentId}`,
      "unsafe-repository",
    );
  }
  const context = await repositoryContext(git, repositoryRoot);
  const staged = await git(["diff", "--cached", "--name-only", "-z"]);
  if (staged.length > 0) {
    throw new JournalPublishError(
      "Publish refused because the repository already has staged changes",
      "unsafe-repository",
    );
  }
  const files = await pathsForPendingRename(contentId, repositoryRoot, git);
  for (const file of pathsFor(contentId)) {
    const stat = await fs
      .lstat(path.join(repositoryRoot, file))
      .catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new JournalPublishError(
        `Publish source is not a regular file: ${file}`,
        "unsafe-repository",
      );
    }
  }
  const trackedChanges = (await git(["diff", "--name-only", "--", ...files]))
    .split("\n")
    .filter(Boolean);
  const untracked = (
    await git(["ls-files", "--others", "--exclude-standard", "--", ...files])
  )
    .split("\n")
    .filter(Boolean);
  const changed = [...new Set([...trackedChanges, ...untracked])].sort();
  if (changed.length === 0) {
    throw new JournalPublishError(
      "Canonical Journal entry has no changes to publish",
      "nothing-to-publish",
    );
  }
  return {
    ...context,
    files: changed,
    diff: [
      await git(["diff", "--", ...files]),
      ...untracked.map((file) => `untracked: ${file}`),
    ]
      .filter(Boolean)
      .join("\n"),
    commitMessage: journalPublishCommitMessage(contentId),
  };
}

export async function publishSavedJournalEntry(
  draft: JournalEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  journalRoot = path.join(repositoryRoot, "src/content/journal"),
): Promise<JournalPublishResult> {
  if (dirty)
    throw new JournalPublishError(
      "Save the draft before publishing",
      "dirty-draft",
    );
  if (!validateJournalEditorDraft(draft).capabilities.publish)
    throw new JournalPublishError(
      "Journal entry is blocked from publishing",
      "publish-blocked",
    );
  const canonical = createJournalEditorDraft(
    await readJournalEditorEntry(draft.contentId, journalRoot),
  );
  if (JSON.stringify(draft) !== JSON.stringify(canonical))
    throw new JournalPublishError(
      "Editor state does not match the reread canonical files",
      "canonical-mismatch",
    );

  const git = createGit(repositoryRoot);
  const inspection = await inspectJournalPublish(
    draft.contentId,
    repositoryRoot,
    git,
  );
  const allFiles = inspection.files;
  const expectedFiles = await Promise.all(
    allFiles.map((file) =>
      fs.readFile(path.join(repositoryRoot, file), "utf8").catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }),
    ),
  );
  try {
    await git(["add", "-A", "--", ...allFiles]);
    const staged = (await git(["diff", "--cached", "--name-only"]))
      .split("\n")
      .filter(Boolean)
      .sort();
    if (
      staged.length === 0 ||
      staged.some(
        (file) => !allFiles.includes(file as (typeof allFiles)[number]),
      )
    ) {
      throw new JournalPublishError(
        "Staged files escaped the Journal publish boundary",
        "unsafe-repository",
      );
    }
    for (const [index, file] of allFiles.entries()) {
      if (expectedFiles[index] === null) {
        if (await git(["ls-files", "--cached", "--", file]))
          throw new JournalPublishError(
            "Deleted Journal Rename source remained in the staged index",
            "canonical-mismatch",
          );
        continue;
      }
      const { stdout: stagedContent } = await execFile(
        "git",
        ["show", `:${file}`],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      if (stagedContent !== expectedFiles[index]) {
        throw new JournalPublishError(
          "Canonical Journal files changed while Publish was staging them",
          "canonical-mismatch",
        );
      }
    }
    await git(["commit", "-m", inspection.commitMessage]);
  } catch (error) {
    await git(["reset", "--", ...allFiles]).catch(() => undefined);
    if (error instanceof JournalPublishError) throw error;
    throw new JournalPublishError(
      "Failed to commit Journal entry",
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
