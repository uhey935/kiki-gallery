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
import {
  sha256,
  type WorksAssetPublishManifest,
  type WorksAssetPublishManifestEntry,
} from "./works-asset-publish-manifest.ts";
import { WORKS_ASSET_POLICY } from "./works-asset-policy.ts";

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
  files: string[];
};

export type WorksRenamePublishEvidence = {
  operationId: string;
  planHash: string;
};

async function renamePublishPaths(
  repositoryRoot: string,
  contentId: string,
  evidence?: WorksRenamePublishEvidence,
) {
  if (!evidence) return null;
  if (
    !/^[0-9a-f-]{36}$/i.test(evidence.operationId) ||
    !/^[a-f0-9]{64}$/.test(evidence.planHash)
  )
    throw new WorksPublishError(
      "Rename Publish evidence identity is invalid",
      "unsafe-repository",
    );
  const file = path.join(
    repositoryRoot,
    ".kiki-editor/content-lifecycle/operations",
    evidence.operationId,
    "operation.json",
  );
  const stat = await fs.lstat(file).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new WorksPublishError(
      "Completed Rename evidence is missing or unsafe",
      "unsafe-repository",
    );
  const record = JSON.parse(await fs.readFile(file, "utf8")) as {
    state?: string;
    operation?: string;
    plan?: {
      planHash?: string;
      destinationContentId?: string;
      publishPaths?: string[];
      sourceFiles?: Array<{ file: string; hash: string }>;
      referenceEdits?: Array<{ file: string; resultingHash: string }>;
    };
  };
  if (
    record.state !== "completed" ||
    record.operation !== "works-rename" ||
    record.plan?.planHash !== evidence.planHash ||
    record.plan.destinationContentId !== contentId ||
    !Array.isArray(record.plan.publishPaths)
  )
    throw new WorksPublishError(
      "Rename Publish evidence does not match this workspace",
      "unsafe-repository",
    );
  return record.plan;
}

export class WorksPublishError extends Error {
  readonly code:
    | "dirty-draft"
    | "publish-blocked"
    | "canonical-mismatch"
    | "asset-publish-manifest-mismatch"
    | "asset-publish-canonical-mismatch"
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

function pathsFor(contentId: string) {
  const root = path.posix.join("src/content/works", contentId);
  return [
    path.posix.join(root, "index.yaml"),
    path.posix.join(root, "ja.md"),
    path.posix.join(root, "en.md"),
  ];
}

function repositoryPathForAsset(asset: WorksAssetPublishManifestEntry) {
  if (!asset.src.startsWith(WORKS_ASSET_POLICY.publicPrefix)) return null;
  const basename = asset.src.slice(WORKS_ASSET_POLICY.publicPrefix.length);
  if (!basename || path.basename(basename) !== basename) return null;
  return path.posix.join("public/images/works", basename);
}

async function verifyManifestAssets(
  manifest: WorksAssetPublishManifest,
  contentId: string,
  repositoryRoot: string,
) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.assets) ||
    manifest.contentId !== contentId ||
    JSON.stringify(manifest.contentPaths) !==
      JSON.stringify(pathsFor(contentId)) ||
    typeof manifest.baselineSha256 !== "string" ||
    manifest.assets.some(
      (asset) =>
        !asset ||
        typeof asset.src !== "string" ||
        typeof asset.sha256 !== "string" ||
        !Number.isSafeInteger(asset.byteSize) ||
        asset.byteSize < 0 ||
        !Number.isSafeInteger(asset.width) ||
        asset.width < 1 ||
        !Number.isSafeInteger(asset.height) ||
        asset.height < 1 ||
        (
          {
            avif: "image/avif",
            jpg: "image/jpeg",
            png: "image/png",
            webp: "image/webp",
          } as const
        )[asset.format] !== asset.mime,
    ) ||
    new Set(manifest.assets.map((asset) => asset.src)).size !==
      manifest.assets.length
  )
    throw new WorksPublishError(
      "Asset Publish manifest ownership or paths are invalid",
      "asset-publish-manifest-mismatch",
    );
  const assetRoot = path.join(repositoryRoot, "public/images/works");
  const rootStat = await fs.lstat(assetRoot).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw new WorksPublishError(
      "Canonical asset root is unsafe",
      "asset-publish-canonical-mismatch",
    );
  const realRoot = await fs.realpath(assetRoot);
  const verified: {
    file: string;
    asset: WorksAssetPublishManifestEntry;
  }[] = [];
  for (const asset of manifest.assets) {
    const file = repositoryPathForAsset(asset);
    if (!file)
      throw new WorksPublishError(
        "Asset Publish manifest path is invalid",
        "asset-publish-manifest-mismatch",
      );
    const absolute = path.join(repositoryRoot, file);
    const stat = await fs.lstat(absolute).catch(() => null);
    const parent = await fs.realpath(path.dirname(absolute)).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || parent !== realRoot)
      throw new WorksPublishError(
        "Canonical asset is missing or unsafe",
        "asset-publish-canonical-mismatch",
      );
    const bytes = await fs.readFile(absolute);
    if (bytes.byteLength !== asset.byteSize || sha256(bytes) !== asset.sha256)
      throw new WorksPublishError(
        "Canonical asset no longer matches its Save manifest",
        "asset-publish-canonical-mismatch",
      );
    verified.push({ file, asset });
  }
  return verified;
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
  manifest?: WorksAssetPublishManifest,
  renameEvidence?: WorksRenamePublishEvidence,
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
  const contentFiles = pathsFor(contentId);
  for (const file of contentFiles) {
    const stat = await fs
      .lstat(path.join(repositoryRoot, file))
      .catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink())
      throw new WorksPublishError(
        `Publish source is not a regular file: ${file}`,
        "unsafe-repository",
      );
  }
  const file = contentFiles[0];
  const assetFiles = manifest
    ? (await verifyManifestAssets(manifest, contentId, repositoryRoot)).map(
        ({ file }) => file,
      )
    : [];
  const renamePlan = await renamePublishPaths(
    repositoryRoot,
    contentId,
    renameEvidence,
  );
  const allowed = renamePlan
    ? renamePlan.publishPaths!
    : [...contentFiles, ...assetFiles];
  if (renamePlan && assetFiles.length)
    throw new WorksPublishError(
      "Rename Publish cannot replay an asset manifest",
      "asset-publish-manifest-mismatch",
    );
  const files: string[] = [];
  for (const candidate of allowed)
    if (await git(["status", "--porcelain", "--", candidate]))
      files.push(candidate);
  if (files.length === 0)
    throw new WorksPublishError(
      "Canonical Works entry has no changes to publish",
      "nothing-to-publish",
    );
  return {
    ...context,
    file,
    diff: await git(["diff", "--", ...contentFiles]),
    commitMessage: worksPublishCommitMessage(contentId),
    files,
  };
}

export async function publishSavedWorksEntry(
  draft: WorksEditorDraftState,
  baseline: WorksEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  worksRoot = path.join(repositoryRoot, "src/content/works"),
  manifest?: WorksAssetPublishManifest,
  renameEvidence?: WorksRenamePublishEvidence,
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
  if (
    manifest &&
    (manifest.contentId !== draft.contentId ||
      manifest.baselineSha256 !== sha256(canonical.sourceRaw))
  )
    throw new WorksPublishError(
      "Asset Publish manifest does not belong to the saved Markdown baseline",
      "asset-publish-manifest-mismatch",
    );

  const git = createGit(repositoryRoot);
  const verifiedAssets = manifest
    ? await verifyManifestAssets(manifest, draft.contentId, repositoryRoot)
    : [];
  const inspection = await inspectWorksPublish(
    draft.contentId,
    repositoryRoot,
    git,
    manifest,
    renameEvidence,
  );
  try {
    await git(["add", "--", ...inspection.files]);
    const staged = (
      await git(["diff", "--cached", "--name-only", "--no-renames"])
    )
      .split("\n")
      .filter(Boolean);
    if (
      JSON.stringify(staged.sort()) !==
      JSON.stringify([...inspection.files].sort())
    )
      throw new WorksPublishError(
        `Staged files escaped the Works publish boundary: expected ${inspection.files.sort().join(", ")}; received ${staged.sort().join(", ")}`,
        "unsafe-repository",
      );
    if (!canonical.sourceFiles)
      throw new WorksPublishError("Three-file Works baseline is unavailable", "canonical-mismatch");
    for (const [key, file] of ([
      ["shared", `src/content/works/${draft.contentId}/index.yaml`],
      ["ja", `src/content/works/${draft.contentId}/ja.md`],
      ["en", `src/content/works/${draft.contentId}/en.md`],
    ] as const)) {
      if (!inspection.files.includes(file)) continue;
      const { stdout: stagedContent } = await execFile(
        "git", ["show", `:${file}`], { cwd: repositoryRoot, encoding: "utf8" },
      );
      if (stagedContent !== canonical.sourceFiles[key])
        throw new WorksPublishError(
          "Canonical Works unit changed while Publish was staging it",
          "canonical-mismatch",
        );
    }
    const renamePlan = await renamePublishPaths(
      repositoryRoot,
      draft.contentId,
      renameEvidence,
    );
    if (renamePlan) {
      for (const source of renamePlan.sourceFiles ?? []) {
        const oldStatus = await git([
          "diff", "--cached", "--name-status", "--no-renames", "--", source.file,
        ]);
        if (!oldStatus.startsWith("D\t"))
          throw new WorksPublishError("Old Work deletion is not staged", "canonical-mismatch");
        const destination = `src/content/works/${draft.contentId}/${path.posix.basename(source.file)}`;
        const { stdout: renamedBytes } = await execFile(
          "git", ["show", `:${destination}`], { cwd: repositoryRoot, encoding: "buffer" },
        );
        if (sha256(renamedBytes) !== source.hash)
          throw new WorksPublishError("Renamed Work bytes do not match the old Work identity", "canonical-mismatch");
      }
      for (const edit of renamePlan.referenceEdits ?? []) {
        const { stdout: stagedBytes } = await execFile(
          "git",
          ["show", `:${edit.file}`],
          { cwd: repositoryRoot, encoding: "buffer" },
        );
        if (sha256(stagedBytes) !== edit.resultingHash)
          throw new WorksPublishError(
            `Staged reference does not match Rename evidence: ${edit.file}`,
            "canonical-mismatch",
          );
      }
    }
    for (const verified of verifiedAssets) {
      const reread = await fs.readFile(
        path.join(repositoryRoot, verified.file),
      );
      if (
        reread.byteLength !== verified.asset.byteSize ||
        sha256(reread) !== verified.asset.sha256
      )
        throw new WorksPublishError(
          "Canonical asset changed while Publish was staging it",
          "asset-publish-canonical-mismatch",
        );
      if (inspection.files.includes(verified.file)) {
        const { stdout: stagedBytes } = await execFile(
          "git",
          ["show", `:${verified.file}`],
          { cwd: repositoryRoot, encoding: "buffer" },
        );
        if (
          stagedBytes.byteLength !== verified.asset.byteSize ||
          sha256(stagedBytes) !== verified.asset.sha256
        )
          throw new WorksPublishError(
            "Staged asset does not match its Save manifest",
            "asset-publish-canonical-mismatch",
          );
      }
    }
    await git(["commit", "-m", inspection.commitMessage]);
  } catch (error) {
    await git(["reset", "--", ...inspection.files]).catch(() => undefined);
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
