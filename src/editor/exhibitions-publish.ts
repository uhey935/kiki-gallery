import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
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
    | "publish-set-mismatch"
    | "nothing-to-publish"
    | "publish-failed";
  constructor(
    message: string,
    code:
      | "dirty-draft"
      | "publish-blocked"
      | "canonical-mismatch"
      | "unsafe-repository"
      | "publish-set-mismatch"
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
type RenameEvidence = {
  state: "completed";
  plan: {
    operation: "exhibitions-rename";
    destinationContentId: string;
    repositoryBranch: string;
    repositoryUpstream: string;
    publishPaths: string[];
    sourceFile: { file: string };
  };
  preimages: Record<string, { hash: string; bytes: string }>;
  prospective: Record<string, { hash: string; bytes: string }>;
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function completedRenameEvidence(
  repositoryRoot: string,
  contentId: string,
) {
  const operations = path.join(
    repositoryRoot,
    ".kiki-editor/content-lifecycle/operations",
  );
  const entries = await fs
    .readdir(operations, { withFileTypes: true })
    .catch(() => []);
  const matches: RenameEvidence[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const file = path.join(operations, entry.name, "operation.json");
    const stat = await fs.lstat(file).catch(() => undefined);
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    let evidence: RenameEvidence;
    try {
      evidence = JSON.parse(await fs.readFile(file, "utf8")) as RenameEvidence;
    } catch (error) {
      throw new ExhibitionsPublishError(
        `Rename evidence is unreadable: ${path.relative(repositoryRoot, file)}`,
        "publish-set-mismatch",
        { cause: error },
      );
    }
    if (
      evidence.state === "completed" &&
      evidence.plan?.operation === "exhibitions-rename" &&
      evidence.plan.destinationContentId === contentId
    ) {
      const sourceStillInHead = await execFile(
        "git",
        ["cat-file", "-e", `HEAD:${evidence.plan.sourceFile.file}`],
        { cwd: repositoryRoot },
      )
        .then(() => true)
        .catch(() => false);
      if (sourceStillInHead) matches.push(evidence);
    }
  }
  if (matches.length > 1)
    throw new ExhibitionsPublishError(
      "Multiple pending Rename records match this Exhibition.",
      "publish-set-mismatch",
    );
  return matches[0];
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
  const directory = path.posix.join("src/content/exhibitions", contentId);
  const file = path.posix.join(directory, "index.yaml");
  const stat = await fs
    .lstat(path.join(repositoryRoot, directory))
    .catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new ExhibitionsPublishError(
      "Unsafe Exhibition source",
      "unsafe-repository",
    );
  const evidence = await completedRenameEvidence(repositoryRoot, contentId);
  const files = evidence?.plan.publishPaths ?? ["en.md", "index.yaml", "ja.md"].map(name => path.posix.join(directory, name));
  if (evidence) {
    if (
      evidence.plan.repositoryBranch !== repositoryContext.branch ||
      evidence.plan.repositoryUpstream !==
        `${repositoryContext.remote}/${repositoryContext.branch}`
    )
      throw new ExhibitionsPublishError(
        "Rename evidence does not match the current Git branch.",
        "publish-set-mismatch",
      );
    for (const [candidate, expected] of Object.entries(evidence.prospective)) {
      const bytes = await fs
        .readFile(path.join(repositoryRoot, candidate))
        .catch(() => undefined);
      if (!bytes || hash(bytes) !== expected.hash)
        throw new ExhibitionsPublishError(
          `Canonical Rename result does not match evidence: ${candidate}`,
          "publish-set-mismatch",
        );
    }
    for (const [candidate, expected] of Object.entries(evidence.preimages)) {
      const head = await execFile("git", ["show", `HEAD:${candidate}`], {
        cwd: repositoryRoot,
      })
        .then(({ stdout }) => stdout)
        .catch(() => undefined);
      if (!head || hash(Buffer.from(head)) !== expected.hash)
        throw new ExhibitionsPublishError(
          `Git HEAD preimage does not match Rename evidence: ${candidate}`,
          "publish-set-mismatch",
        );
    }
  }
  if (!(await git(["status", "--porcelain", "--", ...files])))
    throw new ExhibitionsPublishError(
      "Canonical Exhibition has no changes",
      "nothing-to-publish",
    );
  return {
    ...repositoryContext,
    file,
    files,
    evidence,
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
    await git(["add", "--", ...inspection.files]);
    const stagedNames = (
      await git(["diff", "--cached", "--name-only", "--no-renames"])
    )
      .split("\n")
      .filter(Boolean)
      .sort();
    if (
      JSON.stringify(stagedNames) !==
      JSON.stringify([...inspection.files].sort())
    )
      throw new ExhibitionsPublishError(
        "Staging escaped Exhibition boundary",
        "unsafe-repository",
      );
    await git(["commit", "-m", inspection.commitMessage]);
  } catch (error) {
    await git(["reset", "--", ...inspection.files]).catch(() => undefined);
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
