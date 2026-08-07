import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { isContentId } from "./content-id.ts";
import {
  createArtistsEditorDraft,
  validateArtistsEditorDraft,
  type ArtistsEditorDraftState,
} from "./artists-draft-state.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
const execFile = promisify(execFileCallback);
type Git = (args: string[]) => Promise<string>;
export type ArtistsPublishResult =
  | { state: "published"; commit: string; branch: string; remote: string }
  | {
      state: "committed-push-failed";
      commit: string;
      branch: string;
      remote: string;
      error: string;
    };
export class ArtistsPublishError extends Error {
  readonly code:
    | "dirty-draft"
    | "publish-blocked"
    | "canonical-mismatch"
    | "unsafe-repository"
    | "nothing-to-publish"
    | "publish-failed";
  constructor(
    message: string,
    code: ArtistsPublishError["code"],
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
    throw new ArtistsPublishError(
      "Repository requires a matching branch upstream",
      "unsafe-repository",
      { cause: error },
    );
  }
}
export async function inspectArtistsPublish(
  contentId: string,
  repositoryRoot = path.resolve("."),
  git = createGit(repositoryRoot),
) {
  if (!isContentId(contentId))
    throw new ArtistsPublishError(
      "Invalid Artist Content ID",
      "unsafe-repository",
    );
  const repositoryContext = await context(git, repositoryRoot);
  if ((await git(["diff", "--cached", "--name-only", "-z"])).length)
    throw new ArtistsPublishError(
      "Repository already has staged changes",
      "unsafe-repository",
    );
  const file = path.posix.join("src/content/artists", `${contentId}.md`);
  const stat = await fs
    .lstat(path.join(repositoryRoot, file))
    .catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new ArtistsPublishError("Unsafe Artist source", "unsafe-repository");
  if (!(await git(["status", "--porcelain", "--", file])))
    throw new ArtistsPublishError(
      "Canonical Artist has no changes",
      "nothing-to-publish",
    );
  return {
    ...repositoryContext,
    file,
    commitMessage: `Publish artist: ${contentId}`,
  };
}
export async function publishSavedArtistsEntry(
  draft: ArtistsEditorDraftState,
  baseline: ArtistsEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  root = path.join(repositoryRoot, "src/content/artists"),
): Promise<ArtistsPublishResult> {
  if (dirty || JSON.stringify(draft) !== JSON.stringify(baseline))
    throw new ArtistsPublishError("Save before publishing", "dirty-draft");
  if (!validateArtistsEditorDraft(draft).capabilities.publish)
    throw new ArtistsPublishError(
      "Artist is blocked from publishing",
      "publish-blocked",
    );
  const canonical = createArtistsEditorDraft(
    await readArtistsEditorEntry(draft.contentId, root),
  );
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(baseline))
    throw new ArtistsPublishError(
      "Saved baseline does not match canonical Artist",
      "canonical-mismatch",
    );
  const git = createGit(repositoryRoot);
  const inspection = await inspectArtistsPublish(
    draft.contentId,
    repositoryRoot,
    git,
  );
  try {
    await git(["add", "--", inspection.file]);
    if ((await git(["diff", "--cached", "--name-only"])) !== inspection.file)
      throw new ArtistsPublishError(
        "Staging escaped Artist boundary",
        "unsafe-repository",
      );
    const staged = (
      await execFile("git", ["show", `:${inspection.file}`], {
        cwd: repositoryRoot,
        encoding: "utf8",
      })
    ).stdout;
    if (staged !== canonical.sourceRaw)
      throw new ArtistsPublishError(
        "Canonical Artist changed during Publish",
        "canonical-mismatch",
      );
    await git(["commit", "-m", inspection.commitMessage]);
  } catch (error) {
    await git(["reset", "--", inspection.file]).catch(() => undefined);
    if (error instanceof ArtistsPublishError) throw error;
    throw new ArtistsPublishError("Failed to commit Artist", "publish-failed", {
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
