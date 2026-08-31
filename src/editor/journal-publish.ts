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
import { inspectJournalHeroCandidate } from "./journal-hero-assets.ts";
import {
  journalContentPaths,
  resolveJournalHeroAssetPath,
} from "./journal-hero-publish-evidence.ts";
import {
  HeroAssetPublishEvidenceStore,
  heroPublishSha256,
  type HeroAssetPublishEvidenceV1,
} from "./hero-asset-publish-evidence.ts";
import { WORKS_ASSET_POLICY } from "./works-asset-policy.ts";

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

async function verifyHeroEvidence(
  evidence: HeroAssetPublishEvidenceV1,
  contentId: string,
  repositoryRoot: string,
) {
  if (
    evidence.collection !== "journal" ||
    evidence.contentId !== contentId ||
    evidence.state !== "pending" ||
    JSON.stringify(evidence.content.map(({ path: file }) => file)) !==
      JSON.stringify(journalContentPaths(contentId)) ||
    evidence.assets.length !== 1
  )
    throw new JournalPublishError(
      "Hero asset Publish evidence ownership is invalid",
      "unsafe-repository",
    );
  for (const expected of evidence.content) {
    const bytes = await fs
      .readFile(path.join(repositoryRoot, expected.path))
      .catch(() => undefined);
    if (
      !bytes ||
      bytes.byteLength !== expected.byteSize ||
      heroPublishSha256(bytes) !== expected.sha256
    )
      throw new JournalPublishError(
        "Canonical Journal content no longer matches Hero Publish evidence",
        "canonical-mismatch",
      );
  }
  const asset = evidence.assets[0];
  const resolved = resolveJournalHeroAssetPath(repositoryRoot, asset.src);
  if (resolved.relative !== asset.path)
    throw new JournalPublishError(
      "Hero asset Publish evidence path is invalid",
      "unsafe-repository",
    );
  const stat = await fs.lstat(resolved.absolute).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new JournalPublishError(
      "Canonical Hero asset is missing or unsafe",
      "unsafe-repository",
    );
  const bytes = await fs.readFile(resolved.absolute);
  if (
    bytes.byteLength !== asset.byteSize ||
    heroPublishSha256(bytes) !== asset.sha256
  )
    throw new JournalPublishError(
      "Canonical Hero asset no longer matches Publish evidence",
      "canonical-mismatch",
    );
  const inspected = inspectJournalHeroCandidate({
    contentId,
    declaredMime: asset.mime,
    bytes,
  });
  if (
    inspected.proposedSrc !== asset.src ||
    inspected.media.format !== asset.format ||
    inspected.media.mime !== asset.mime ||
    inspected.media.width !== asset.width ||
    inspected.media.height !== asset.height
  )
    throw new JournalPublishError(
      "Canonical Hero decoded identity no longer matches Publish evidence",
      "canonical-mismatch",
    );
  return asset;
}

async function assertHeadIdenticalHero(src: string, repositoryRoot: string) {
  const resolved = resolveJournalHeroAssetPath(repositoryRoot, src);
  const stat = await fs.lstat(resolved.absolute).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new JournalPublishError(
      "Canonical Hero is unavailable and has no Publish evidence",
      "unsafe-repository",
    );
  const current = await fs.readFile(resolved.absolute);
  const head = await execFile("git", ["show", `HEAD:${resolved.relative}`], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: WORKS_ASSET_POLICY.maxBytes + 1024,
  })
    .then(({ stdout }) => Buffer.from(stdout))
    .catch(() => undefined);
  if (!head?.equals(current))
    throw new JournalPublishError(
      "Changed Hero asset has no durable Publish evidence",
      "unsafe-repository",
    );
}

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
  heroEvidence?: HeroAssetPublishEvidenceV1,
  heroSrc?: string,
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
  const renameInferred = files.length > fileNames.length;
  if (renameInferred && heroEvidence)
    throw new JournalPublishError(
      "Resolve the pending Journal Hero publication before publishing Rename",
      "unsafe-repository",
    );
  if (heroEvidence)
    await verifyHeroEvidence(heroEvidence, contentId, repositoryRoot);
  else if (heroSrc) await assertHeadIdenticalHero(heroSrc, repositoryRoot);
  const allowedFiles = [
    ...files,
    ...(heroEvidence?.state === "pending"
      ? heroEvidence.assets.map(({ path: file }) => file)
      : []),
  ];
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
  const trackedChanges = (
    await git(["diff", "--name-only", "--", ...allowedFiles])
  )
    .split("\n")
    .filter(Boolean);
  const untracked = (
    await git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      ...allowedFiles,
    ])
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
      await git(["diff", "--", ...allowedFiles]),
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
  evidenceStore = new HeroAssetPublishEvidenceStore(repositoryRoot),
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
  let heroEvidence: HeroAssetPublishEvidenceV1 | undefined;
  try {
    heroEvidence = await evidenceStore.read("journal", draft.contentId);
  } catch (error) {
    throw new JournalPublishError(
      "Hero asset Publish evidence is corrupt or unsafe",
      "unsafe-repository",
      { cause: error },
    );
  }
  if (heroEvidence?.state === "committed-push-failed") {
    const context = await repositoryContext(git, repositoryRoot);
    if (
      (await git(["diff", "--cached", "--name-only", "-z"])).length ||
      (await git(["rev-parse", "HEAD"])) !== heroEvidence.commit
    )
      throw new JournalPublishError(
        "Hero push recovery evidence does not match repository HEAD",
        "unsafe-repository",
      );
    try {
      await git([
        "push",
        context.remote,
        `${heroEvidence.commit}:${context.branch}`,
      ]);
      await evidenceStore.delete("journal", draft.contentId);
      return {
        state: "published",
        commit: heroEvidence.commit!,
        branch: context.branch,
        remote: context.remote,
      };
    } catch (error) {
      return {
        state: "committed-push-failed",
        commit: heroEvidence.commit!,
        branch: context.branch,
        remote: context.remote,
        error: error instanceof Error ? error.message : "Git push failed",
      };
    }
  }
  const inspection = await inspectJournalPublish(
    draft.contentId,
    repositoryRoot,
    git,
    heroEvidence,
    canonical.shared.state === "editable"
      ? canonical.shared.value.hero.image
      : "",
  );
  const allFiles = inspection.files;
  const expectedFiles = await Promise.all(
    allFiles.map((file) =>
      fs.readFile(path.join(repositoryRoot, file)).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }),
    ),
  );
  try {
    await git(["add", "-A", "--", ...allFiles]);
    const staged = (
      await git(["diff", "--cached", "--name-only", "--no-renames"])
    )
      .split("\n")
      .filter(Boolean)
      .sort();
    if (JSON.stringify(staged) !== JSON.stringify([...allFiles].sort())) {
      throw new JournalPublishError(
        `Staged files escaped the Journal publish boundary: expected ${[...allFiles].sort().join(",")}; got ${staged.join(",")}`,
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
        {
          cwd: repositoryRoot,
          encoding: "buffer",
          maxBuffer: WORKS_ASSET_POLICY.maxBytes + 1024,
        },
      );
      if (!Buffer.from(stagedContent).equals(expectedFiles[index])) {
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
    if (heroEvidence) await evidenceStore.delete("journal", draft.contentId);
    return {
      state: "published",
      commit,
      branch: inspection.branch,
      remote: inspection.remote,
    };
  } catch (error) {
    if (heroEvidence)
      await evidenceStore.write({
        ...heroEvidence,
        state: "committed-push-failed",
        commit,
      });
    return {
      state: "committed-push-failed",
      commit,
      branch: inspection.branch,
      remote: inspection.remote,
      error: error instanceof Error ? error.message : "Git push failed",
    };
  }
}
