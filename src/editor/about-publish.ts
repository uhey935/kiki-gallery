import { createHash } from "node:crypto";
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
import { validateAboutDraftAssets } from "./about-assets.ts";
import {
  AboutPublishEvidenceStore,
  type AboutPublishEvidence,
} from "./about-publish-evidence.ts";
import { readAboutEditorEntry } from "./about-state.ts";

const execFile = promisify(callback);
export const ABOUT_PUBLISH_FILES = [
  "src/content/about/about/en.md",
  "src/content/about/about/index.yaml",
  "src/content/about/about/ja.md",
] as const;
type Git = (args: string[], binary?: boolean) => Promise<string | Buffer>;
export type AboutPublishHook = (point: string) => void | Promise<void>;
export type AboutPublishOptions = {
  git?: Git;
  evidence?: AboutPublishEvidenceStore;
  hook?: AboutPublishHook;
  publicRoot?: string;
};

export class AboutPublishError extends Error {
  readonly code:
    | "dirty-draft"
    | "publish-blocked"
    | "canonical-mismatch"
    | "unsafe-repository"
    | "publish-set-mismatch"
    | "nothing-to-publish"
    | "publish-failed"
    | "publish-evidence-active"
    | "recovery-required"
    | "retry-blocked";
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
  async (args, binary = false) => {
    const result = await execFile("git", args, {
      cwd: root,
      encoding: binary ? null : "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return binary
      ? Buffer.from(result.stdout as Buffer)
      : String(result.stdout).trim();
  };
const text = async (git: Git, args: string[]) => String(await git(args));
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const split = (value: string) => value.split("\n").filter(Boolean).sort();
const same = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function gitIdentity(git: Git) {
  const branch = await text(git, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  const upstream = await text(git, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  const slash = upstream.indexOf("/"),
    remote = upstream.slice(0, slash);
  if (!branch || slash < 1 || upstream.slice(slash + 1) !== branch)
    throw new Error("upstream mismatch");
  return { branch, upstream, remote };
}
async function fetchExact(
  git: Git,
  identity: Awaited<ReturnType<typeof gitIdentity>>,
) {
  await git([
    "fetch",
    "--no-tags",
    identity.remote,
    `refs/heads/${identity.branch}:refs/remotes/${identity.remote}/${identity.branch}`,
  ]);
  return text(git, ["rev-parse", identity.upstream]);
}
async function canonicalSnapshot(
  repositoryRoot: string,
  root: string,
  publicRoot: string,
) {
  const entry = await readAboutEditorEntry(root);
  if (entry.structuralStatus !== "valid")
    throw new Error("invalid canonical About");
  const draft = createAboutEditorDraft(entry);
  if (!validateAboutEditorDraft(draft).capabilities.publish)
    throw new Error("invalid canonical About draft");
  if (!(await validateAboutDraftAssets(draft, publicRoot)).valid)
    throw new Error("invalid canonical About assets");
  const paths = await Promise.all(
    ABOUT_PUBLISH_FILES.map(async (file) => {
      const absolute = path.join(repositoryRoot, file),
        stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("unsafe About file");
      const bytes = await fs.readFile(absolute);
      return {
        path: file,
        bytes,
        sha256: sha256(bytes),
        byteSize: bytes.byteLength,
      };
    }),
  );
  return { draft, paths };
}
async function assertSnapshot(
  snapshot: Awaited<ReturnType<typeof canonicalSnapshot>>,
  repositoryRoot: string,
) {
  for (const expected of snapshot.paths) {
    const bytes = await fs.readFile(path.join(repositoryRoot, expected.path));
    if (
      bytes.byteLength !== expected.byteSize ||
      sha256(bytes) !== expected.sha256
    )
      throw new AboutPublishError(
        "Canonical About changed during Publish",
        "canonical-mismatch",
      );
  }
}
async function verifyIndex(
  git: Git,
  expected: string[],
  snapshot: Awaited<ReturnType<typeof canonicalSnapshot>>,
) {
  const staged = split(
    await text(git, ["diff", "--cached", "--name-only", "--no-renames"]),
  );
  if (!same(staged, expected))
    throw new AboutPublishError(
      "Staged About set differs from validated set",
      "publish-set-mismatch",
    );
  for (const file of expected) {
    const bytes = (await git(["show", `:${file}`], true)) as Buffer;
    const item = snapshot.paths.find((candidate) => candidate.path === file)!;
    if (bytes.byteLength !== item.byteSize || sha256(bytes) !== item.sha256)
      throw new AboutPublishError(
        "Staged About blob differs from validated bytes",
        "publish-set-mismatch",
      );
  }
}
async function verifyBoundary(
  git: Git,
  identity: Awaited<ReturnType<typeof gitIdentity>>,
  head: string,
) {
  try {
    const current = await gitIdentity(git);
    if (
      current.branch === identity.branch &&
      current.upstream === identity.upstream &&
      current.remote === identity.remote &&
      (await text(git, ["rev-parse", "HEAD"])) === head
    )
      return;
  } catch {
    // Any unreadable identity is boundary drift.
  }
  throw new AboutPublishError(
    "About Publish Git boundary drifted",
    "unsafe-repository",
  );
}

export async function inspectAboutPublish(
  repositoryRoot = path.resolve("."),
  git: Git = createGit(repositoryRoot),
) {
  try {
    if (await text(git, ["diff", "--cached", "--name-only", "-z"]))
      throw new Error("staged changes exist");
    const identity = await gitIdentity(git),
      remoteHead = await fetchExact(git, identity),
      startingHead = await text(git, ["rev-parse", "HEAD"]);
    if (startingHead !== remoteHead)
      throw new Error("local HEAD is not synchronized with upstream");
    const files = split(
      await text(git, [
        "diff",
        "--name-only",
        "--no-renames",
        "HEAD",
        "--",
        ...ABOUT_PUBLISH_FILES,
      ]),
    );
    if (!files.length)
      throw new AboutPublishError(
        "Canonical About has no changes",
        "nothing-to-publish",
      );
    if (files.some((file) => !ABOUT_PUBLISH_FILES.includes(file as never)))
      throw new Error("About change escaped allowlist");
    return {
      ...identity,
      startingHead,
      files,
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
  options: AboutPublishOptions = {},
) {
  if (dirty || isAboutEditorDraftDirty(draft, baseline))
    throw new AboutPublishError("Save before publishing", "dirty-draft");
  if (!validateAboutEditorDraft(draft).capabilities.publish)
    throw new AboutPublishError(
      "About draft is structurally blocked",
      "publish-blocked",
    );
  const evidence =
    options.evidence ?? new AboutPublishEvidenceStore(repositoryRoot);
  if (await evidence.read())
    throw new AboutPublishError(
      "About Publish recovery is active; retry it",
      "publish-evidence-active",
    );
  const publicRoot = options.publicRoot ?? path.join(repositoryRoot, "public");
  let snapshot: Awaited<ReturnType<typeof canonicalSnapshot>>;
  try {
    snapshot = await canonicalSnapshot(repositoryRoot, root, publicRoot);
  } catch (error) {
    throw new AboutPublishError(
      "Canonical About or its assets are invalid",
      "canonical-mismatch",
      { cause: error },
    );
  }
  if (JSON.stringify(snapshot.draft) !== JSON.stringify(baseline))
    throw new AboutPublishError(
      "Saved baseline does not match canonical About",
      "canonical-mismatch",
    );
  const git = options.git ?? createGit(repositoryRoot),
    inspection = await inspectAboutPublish(repositoryRoot, git),
    expected = inspection.files;
  try {
    await options.hook?.("after-validation");
    await assertSnapshot(snapshot, repositoryRoot);
    await verifyBoundary(git, inspection, inspection.startingHead);
    await git(["add", "--", ...ABOUT_PUBLISH_FILES]);
    await options.hook?.("after-add");
    await verifyIndex(git, expected, snapshot);
    await assertSnapshot(snapshot, repositoryRoot);
    await verifyBoundary(git, inspection, inspection.startingHead);
    const tree = await text(git, ["write-tree"]),
      treePaths = split(
        await text(git, [
          "diff-tree",
          "--no-commit-id",
          "--name-only",
          "-r",
          inspection.startingHead,
          tree,
        ]),
      );
    if (!same(treePaths, expected))
      throw new AboutPublishError(
        "Commit tree escaped About boundary",
        "publish-set-mismatch",
      );
    const pending: AboutPublishEvidence = {
      version: 1,
      contentId: "about",
      state: "pending",
      branch: inspection.branch,
      upstream: inspection.upstream,
      remote: inspection.remote,
      startingHead: inspection.startingHead,
      paths: snapshot.paths
        .filter((item) => expected.includes(item.path))
        .map(({ path: file, sha256: hash, byteSize }) => ({
          path: file,
          sha256: hash,
          byteSize,
        })),
      createdAt: new Date().toISOString(),
    };
    await evidence.write(pending);
    await options.hook?.("before-commit");
    await verifyBoundary(git, inspection, inspection.startingHead);
    const commit = await text(git, [
      "commit-tree",
      tree,
      "-p",
      inspection.startingHead,
      "-m",
      inspection.commitMessage,
    ]);
    await git([
      "update-ref",
      `refs/heads/${inspection.branch}`,
      commit,
      inspection.startingHead,
    ]);
    const committed: AboutPublishEvidence & { commit: string } = {
      ...pending,
      state: "committed-push-failed",
      commit,
    };
    try {
      await evidence.write(committed);
    } catch (error) {
      throw new AboutPublishError(
        "About commit succeeded but durable commit evidence could not be finalized",
        "recovery-required",
        { cause: error },
      );
    }
    return pushRecordedAboutCommit(committed, git, evidence, options.hook);
  } catch (error) {
    if (error instanceof AboutPublishError) throw error;
    throw new AboutPublishError("Failed to publish About", "publish-failed", {
      cause: error,
    });
  }
}

async function verifyRecordedCommit(
  record: AboutPublishEvidence & { commit: string },
  git: Git,
) {
  const parents = (
    await text(git, ["rev-list", "--parents", "-n", "1", record.commit])
  ).split(" ");
  if (parents.length !== 2 || parents[1] !== record.startingHead)
    throw new Error("recorded parent mismatch");
  const paths = split(
    await text(git, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      record.commit,
    ]),
  );
  if (
    !same(
      paths,
      record.paths.map((item) => item.path),
    )
  )
    throw new Error("recorded path mismatch");
  for (const item of record.paths) {
    const bytes = (await git(
      ["show", `${record.commit}:${item.path}`],
      true,
    )) as Buffer;
    if (bytes.byteLength !== item.byteSize || sha256(bytes) !== item.sha256)
      throw new Error("recorded blob mismatch");
  }
}
async function pushRecordedAboutCommit(
  record: AboutPublishEvidence & { commit: string },
  git: Git,
  evidence: AboutPublishEvidenceStore,
  hook?: AboutPublishHook,
) {
  try {
    await verifyRecordedCommit(record, git);
    const identity = await gitIdentity(git);
    if (
      identity.branch !== record.branch ||
      identity.upstream !== record.upstream ||
      identity.remote !== record.remote
    )
      throw new Error("recorded branch identity mismatch");
    if ((await text(git, ["rev-parse", "HEAD"])) !== record.commit)
      throw new Error("later local commit blocks exact retry");
    const remoteHead = await fetchExact(git, identity);
    if (remoteHead === record.commit) {
      await evidence.delete();
      return {
        state: "published" as const,
        commit: record.commit,
        branch: record.branch,
        remote: record.remote,
      };
    }
    if (remoteHead !== record.startingHead)
      throw new Error("upstream drift blocks exact push");
    await hook?.("before-push");
    await git([
      "push",
      record.remote,
      `${record.commit}:refs/heads/${record.branch}`,
    ]);
    if ((await fetchExact(git, identity)) !== record.commit)
      throw new Error("remote did not accept exact About commit");
    try {
      await evidence.delete();
    } catch (error) {
      return {
        state: "published-evidence-cleanup-failed" as const,
        commit: record.commit,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      state: "published" as const,
      commit: record.commit,
      branch: record.branch,
      remote: record.remote,
    };
  } catch (error) {
    return {
      state: "committed-push-failed" as const,
      commit: record.commit,
      branch: record.branch,
      remote: record.remote,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function retryAboutPublish(
  repositoryRoot = path.resolve("."),
  options: AboutPublishOptions = {},
) {
  const evidence =
    options.evidence ?? new AboutPublishEvidenceStore(repositoryRoot);
  let record = await evidence.read();
  if (!record)
    throw new AboutPublishError(
      "No About Publish recovery is active",
      "retry-blocked",
    );
  const git = options.git ?? createGit(repositoryRoot);
  if (record.state === "pending") {
    const head = await text(git, ["rev-parse", "HEAD"]);
    if (head === record.startingHead)
      throw new AboutPublishError(
        "Pending About Publish did not create a commit",
        "recovery-required",
      );
    const candidate = {
      ...record,
      state: "committed-push-failed" as const,
      commit: head,
    };
    try {
      await verifyRecordedCommit(candidate, git);
      await evidence.write(candidate);
      record = candidate;
    } catch (error) {
      throw new AboutPublishError(
        "Pending About Publish evidence requires manual recovery",
        "recovery-required",
        { cause: error },
      );
    }
  }
  return pushRecordedAboutCommit(
    record as AboutPublishEvidence & { commit: string },
    git,
    evidence,
    options.hook,
  );
}

export async function inspectAboutPublishRecovery(
  repositoryRoot = path.resolve("."),
) {
  const evidence = await new AboutPublishEvidenceStore(repositoryRoot).read();
  return evidence
    ? { active: true, state: evidence.state, commit: evidence.commit }
    : { active: false };
}
