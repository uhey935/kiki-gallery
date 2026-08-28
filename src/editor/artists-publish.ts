import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
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
import { inspectArtistsHeroCandidate } from "./artists-hero-assets.ts";
import { WORKS_ASSET_POLICY } from "./works-asset-policy.ts";
import {
  artistsContentPaths,
  resolveArtistsHeroAssetPath,
} from "./artists-hero-publish-evidence.ts";
import {
  HeroAssetPublishEvidenceStore,
  heroPublishSha256,
  type HeroAssetPublishEvidenceV1,
} from "./hero-asset-publish-evidence.ts";
import {
  abandonRenamePublicationIntent,
  bindRenamePublicationCommit,
  finalizePublishedRename,
  findRenameEvidence,
  prepareRenamePublication,
  publishRecordedRenameCommit,
  type LocatedRenameEvidence,
} from "./content-rename-evidence-lifecycle.ts";
const execFile = promisify(execFileCallback);
type Git = (args: string[]) => Promise<string>;
export type ArtistsPublishResult =
  | { state: "published"; commit: string; branch: string; remote: string; cleanupError?: string }
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
    | "publish-set-mismatch"
    | "publish-evidence-missing"
    | "publish-evidence-corrupt"
    | "publish-evidence-mismatch"
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
      | "publish-evidence-missing"
      | "publish-evidence-corrupt"
      | "publish-evidence-mismatch"
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
export const artistsPublishCommitMessage = (contentId: string) =>
  `Publish artist: ${contentId}`;
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
type RenameEvidence = {
  state: "completed" | "committed-push-failed";
  plan: {
    operation: "artists-rename";
    operationId: string;
    destinationContentId: string;
    repositoryBranch: string;
    repositoryUpstream: string;
    publishPaths: string[];
    sourceFile: { file: string };
  };
  preimages: Record<string, { hash: string; bytes: string }>;
  prospective: Record<string, { hash: string; bytes: string }>;
  publication?: { commit: string; branch: string; upstream: string };
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function verifyPendingEvidence(
  evidence: HeroAssetPublishEvidenceV1,
  contentId: string,
  repositoryRoot: string,
) {
  if (
    evidence.collection !== "artists" ||
    evidence.contentId !== contentId ||
    JSON.stringify(evidence.content.map(({ path: file }) => file)) !==
      JSON.stringify(artistsContentPaths(contentId)) ||
    evidence.assets.length !== 1
  )
    throw new ArtistsPublishError(
      "Hero asset Publish evidence ownership is invalid",
      "publish-evidence-mismatch",
    );
  for (const expected of evidence.content) {
    const absolute = path.join(repositoryRoot, expected.path);
    const stat = await fs.lstat(absolute).catch(() => undefined);
    const bytes =
      stat?.isFile() && !stat.isSymbolicLink()
        ? await fs.readFile(absolute)
        : undefined;
    if (
      !bytes ||
      bytes.byteLength !== expected.byteSize ||
      heroPublishSha256(bytes) !== expected.sha256
    )
      throw new ArtistsPublishError(
        "Canonical Artist content no longer matches Hero Publish evidence",
        "publish-evidence-mismatch",
      );
  }
  const asset = evidence.assets[0];
  const resolved = resolveArtistsHeroAssetPath(repositoryRoot, asset.src);
  if (resolved.relative !== asset.path)
    throw new ArtistsPublishError(
      "Hero asset Publish evidence path is invalid",
      "publish-evidence-mismatch",
    );
  const rootStat = await fs.lstat(resolved.root).catch(() => undefined);
  const stat = await fs.lstat(resolved.absolute).catch(() => undefined);
  const parent = await fs
    .realpath(path.dirname(resolved.absolute))
    .catch(() => undefined);
  if (
    !rootStat?.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !stat?.isFile() ||
    stat.isSymbolicLink() ||
    parent !== (await fs.realpath(resolved.root))
  )
    throw new ArtistsPublishError(
      "Canonical Hero asset is missing or unsafe",
      "publish-evidence-mismatch",
    );
  const bytes = await fs.readFile(resolved.absolute);
  if (
    bytes.byteLength !== asset.byteSize ||
    heroPublishSha256(bytes) !== asset.sha256
  )
    throw new ArtistsPublishError(
      "Canonical Hero asset no longer matches Publish evidence",
      "publish-evidence-mismatch",
    );
  const inspected = await inspectArtistsHeroCandidate({
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
    throw new ArtistsPublishError(
      "Canonical Hero decoded identity no longer matches Publish evidence",
      "publish-evidence-mismatch",
    );
  return asset;
}

async function assertNoUnprovenHeroChange(
  heroSrc: string,
  repositoryRoot: string,
) {
  const resolved = resolveArtistsHeroAssetPath(repositoryRoot, heroSrc);
  const stat = await fs.lstat(resolved.absolute).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new ArtistsPublishError(
      "Canonical Hero asset is unavailable and has no Publish evidence",
      "publish-evidence-missing",
    );
  const current = await fs.readFile(resolved.absolute);
  const head = await execFile("git", ["show", `HEAD:${resolved.relative}`], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: WORKS_ASSET_POLICY.maxBytes + 1024,
  })
    .then(({ stdout }) => stdout)
    .catch(() => undefined);
  if (!head || !Buffer.from(head).equals(current))
    throw new ArtistsPublishError(
      "Changed Hero asset has no durable Publish evidence",
      "publish-evidence-missing",
    );
}
async function completedRenameEvidence(
  repositoryRoot: string,
  contentId: string,
) {
  try {
    return await findRenameEvidence(repositoryRoot, "artists", contentId);
  } catch (error) {
    throw new ArtistsPublishError("Artist Rename evidence is invalid or ambiguous", "publish-set-mismatch", { cause: error });
  }
}
export async function inspectArtistsPublish(
  contentId: string,
  repositoryRoot = path.resolve("."),
  git = createGit(repositoryRoot),
  heroEvidence?: HeroAssetPublishEvidenceV1,
  heroSrc?: string,
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
  const file = path.posix.join("src/content/artists", contentId, "index.yaml");
  const canonicalFiles = artistsContentPaths(contentId);
  const stat = await fs
    .lstat(path.join(repositoryRoot, "src/content/artists", contentId))
    .catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new ArtistsPublishError("Unsafe Artist source", "unsafe-repository");
  for (const candidate of canonicalFiles) {
    const candidateStat = await fs
      .lstat(path.join(repositoryRoot, candidate))
      .catch(() => undefined);
    if (!candidateStat?.isFile() || candidateStat.isSymbolicLink())
      throw new ArtistsPublishError(
        "Unsafe Artist source",
        "unsafe-repository",
      );
  }
  const locatedRenameEvidence = await completedRenameEvidence(
    repositoryRoot,
    contentId,
  );
  const renameEvidence = locatedRenameEvidence?.record as unknown as RenameEvidence | undefined;
  if (renameEvidence && heroEvidence)
    throw new ArtistsPublishError(
      "Rename Publish cannot consume pending Hero asset evidence",
      "publish-evidence-mismatch",
    );
  if (heroEvidence?.state === "pending")
    await verifyPendingEvidence(heroEvidence, contentId, repositoryRoot);
  if (!heroEvidence && !renameEvidence && heroSrc)
    await assertNoUnprovenHeroChange(heroSrc, repositoryRoot);
  const allowed = renameEvidence?.plan.publishPaths ?? [
    ...canonicalFiles,
    ...(heroEvidence?.state === "pending"
      ? heroEvidence.assets.map(({ path: file }) => file)
      : []),
  ];
  const files: string[] = [];
  for (const candidate of allowed)
    if (await git(["status", "--porcelain", "--", candidate]))
      files.push(candidate);
  if (renameEvidence) {
    if (
      renameEvidence.plan.repositoryBranch !== repositoryContext.branch ||
      renameEvidence.plan.repositoryUpstream !==
        `${repositoryContext.remote}/${repositoryContext.branch}`
    )
      throw new ArtistsPublishError(
        "Rename evidence does not match the current Git branch.",
        "publish-set-mismatch",
      );
    for (const [candidate, expected] of Object.entries(
      renameEvidence.prospective,
    )) {
      const bytes = await fs
        .readFile(path.join(repositoryRoot, candidate))
        .catch(() => undefined);
      if (!bytes || hash(bytes) !== expected.hash)
        throw new ArtistsPublishError(
          `Canonical Rename result does not match evidence: ${candidate}`,
          "publish-set-mismatch",
        );
    }
    for (const [candidate, expected] of Object.entries(
      renameEvidence.preimages,
    )) {
      const head = await execFile("git", ["show", `HEAD:${candidate}`], {
        cwd: repositoryRoot,
      })
        .then(({ stdout }) => stdout)
        .catch(() => undefined);
      if (!head || hash(Buffer.from(head)) !== expected.hash)
        throw new ArtistsPublishError(
          `Git HEAD preimage does not match Rename evidence: ${candidate}`,
          "publish-set-mismatch",
        );
    }
  }
  if (!files.length)
    throw new ArtistsPublishError(
      "Canonical Artist has no changes",
      "nothing-to-publish",
    );
  return {
    ...repositoryContext,
    file,
    files,
    evidence: renameEvidence,
    locatedRenameEvidence,
    commitMessage: artistsPublishCommitMessage(contentId),
  };
}
export async function publishSavedArtistsEntry(
  draft: ArtistsEditorDraftState,
  baseline: ArtistsEditorDraftState,
  dirty: boolean,
  repositoryRoot = path.resolve("."),
  root = path.join(repositoryRoot, "src/content/artists"),
  evidenceStore = new HeroAssetPublishEvidenceStore(repositoryRoot),
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
  const repositoryContext = await context(git, repositoryRoot);
  const renameEvidence = await completedRenameEvidence(repositoryRoot, draft.contentId);
  if (["committed-push-failed", "push-outcome-uncertain"].includes(renameEvidence?.record.state ?? "")) {
    if ((await git(["diff", "--cached", "--name-only", "-z"])).length)
      throw new ArtistsPublishError("Rename push retry requires a clean index", "publish-evidence-mismatch");
    try {
      const commit = await publishRecordedRenameCommit(
        renameEvidence,
        repositoryRoot,
        repositoryContext.branch,
        `${repositoryContext.remote}/${repositoryContext.branch}`,
        async (recorded, branch) => { await git(["push", repositoryContext.remote, `${recorded}:${branch}`]); },
        async (recorded, branch) => {
          await git(["fetch", "--no-tags", repositoryContext.remote, `refs/heads/${branch}`]);
          return git(["merge-base", "--is-ancestor", recorded, "FETCH_HEAD"]).then(() => true, () => false);
        },
      );
      const cleanup = await finalizePublishedRename(renameEvidence);
      return { state: "published", commit, branch: repositoryContext.branch, remote: repositoryContext.remote, ...(!cleanup.cleaned ? { cleanupError: cleanup.error } : {}) } as ArtistsPublishResult;
    } catch (error) {
      if (error instanceof ArtistsPublishError) throw error;
      throw new ArtistsPublishError("Rename push recovery failed", "publish-evidence-mismatch", { cause: error });
    }
  }
  let publishEvidence: HeroAssetPublishEvidenceV1 | undefined;
  try {
    publishEvidence = await evidenceStore.read("artists", draft.contentId);
  } catch (error) {
    throw new ArtistsPublishError(
      "Hero asset Publish evidence is corrupt or unsafe",
      "publish-evidence-corrupt",
      { cause: error },
    );
  }
  if (publishEvidence?.state === "committed-push-failed") {
    const repositoryContext = await context(git, repositoryRoot);
    if (
      (await git(["diff", "--cached", "--name-only", "-z"])).length ||
      (await git(["rev-parse", "HEAD"])) !== publishEvidence.commit
    )
      throw new ArtistsPublishError(
        "Push recovery evidence does not match repository HEAD",
        "publish-evidence-mismatch",
      );
    try {
      await git([
        "push",
        repositoryContext.remote,
        `${publishEvidence.commit}:${repositoryContext.branch}`,
      ]);
      await evidenceStore.delete("artists", draft.contentId);
      return {
        state: "published",
        commit: publishEvidence.commit!,
        branch: repositoryContext.branch,
        remote: repositoryContext.remote,
      };
    } catch (error) {
      return {
        state: "committed-push-failed",
        commit: publishEvidence.commit!,
        branch: repositoryContext.branch,
        remote: repositoryContext.remote,
        error: error instanceof Error ? error.message : "Git push failed",
      };
    }
  }
  const inspection = await inspectArtistsPublish(
    draft.contentId,
    repositoryRoot,
    git,
    publishEvidence,
    canonical.data.hero.image,
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
      !stagedNames.length ||
      JSON.stringify(stagedNames) !==
        JSON.stringify([...inspection.files].sort())
    )
      throw new ArtistsPublishError(
        "Staging escaped Artist boundary",
        "unsafe-repository",
      );
    if (!inspection.evidence)
      for (const name of ["index.yaml", "ja.md", "en.md"] as const) {
        const file = `src/content/artists/${draft.contentId}/${name}`;
        if (!stagedNames.includes(file)) continue;
        const staged = await execFile("git", ["show", `:${file}`], {
          cwd: repositoryRoot,
        });
        const entry = await readArtistsEditorEntry(draft.contentId, root);
        if (
          !entry.canonicalFiles ||
          staged.stdout !== entry.canonicalFiles[name]
        )
          throw new ArtistsPublishError(
            "Canonical Artist changed during Publish",
            "canonical-mismatch",
          );
      }
    if (publishEvidence?.state === "pending") {
      await verifyPendingEvidence(
        publishEvidence,
        draft.contentId,
        repositoryRoot,
      );
      for (const asset of publishEvidence.assets)
        if (inspection.files.includes(asset.path)) {
          const staged = await execFile("git", ["show", `:${asset.path}`], {
            cwd: repositoryRoot,
            encoding: "buffer",
            maxBuffer: WORKS_ASSET_POLICY.maxBytes + 1024,
          });
          if (
            staged.stdout.byteLength !== asset.byteSize ||
            heroPublishSha256(staged.stdout) !== asset.sha256
          )
            throw new ArtistsPublishError(
              "Staged Hero asset does not match Publish evidence",
              "publish-evidence-mismatch",
            );
        }
    }
    if (inspection.locatedRenameEvidence)
      await prepareRenamePublication(
        inspection.locatedRenameEvidence as LocatedRenameEvidence,
        inspection.branch,
        `${inspection.remote}/${inspection.branch}`,
      );
    await git(["commit", "-m", inspection.commitMessage]);
  } catch (error) {
    if (inspection.locatedRenameEvidence)
      await abandonRenamePublicationIntent(
        inspection.locatedRenameEvidence as LocatedRenameEvidence,
      ).catch(() => undefined);
    await git(["reset", "--", ...inspection.files]).catch(() => undefined);
    if (error instanceof ArtistsPublishError) throw error;
    throw new ArtistsPublishError("Failed to commit Artist", "publish-failed", {
      cause: error,
    });
  }
  const commit = await git(["rev-parse", "HEAD"]);
  if (inspection.locatedRenameEvidence)
    await bindRenamePublicationCommit(
      inspection.locatedRenameEvidence as LocatedRenameEvidence,
      commit,
      inspection.branch,
      `${inspection.remote}/${inspection.branch}`,
    );
  try {
    if (inspection.locatedRenameEvidence)
      await publishRecordedRenameCommit(
        inspection.locatedRenameEvidence as LocatedRenameEvidence,
        repositoryRoot,
        inspection.branch,
        `${inspection.remote}/${inspection.branch}`,
        async (recorded, branch) => { await git(["push", inspection.remote, `${recorded}:${branch}`]); },
        async () => false,
      );
    else await git(["push", inspection.remote, `HEAD:${inspection.branch}`]);
  } catch (error) {
    if (inspection.locatedRenameEvidence && inspection.locatedRenameEvidence.record.state !== "committed-push-failed")
      throw new ArtistsPublishError("Rename push outcome requires manual recovery", "publish-evidence-mismatch", { cause: error });
    if (publishEvidence?.state === "pending")
      await evidenceStore.write({
        ...publishEvidence,
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
  if (publishEvidence) await evidenceStore.delete("artists", draft.contentId);
  if (inspection.locatedRenameEvidence) {
    const cleanup = await finalizePublishedRename(inspection.locatedRenameEvidence as LocatedRenameEvidence);
    return { state: "published", commit, branch: inspection.branch, remote: inspection.remote, ...(!cleanup.cleaned ? { cleanupError: cleanup.error } : {}) } as ArtistsPublishResult;
  }
  return { state: "published", commit, branch: inspection.branch, remote: inspection.remote };
}
