import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { readArtistsEditorEntry } from "./artists-state.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import { readWorksEditorEntry } from "./works-state.ts";
import { readNewsEditorEntry } from "./news-state.ts";
import {
  type ContentRecoveryRecord,
  type DeletePreimage,
  persistContentRecoveryRecord,
  plannedDeletePublishPaths,
  provePreDeleteBackup,
} from "./delete-safety-contracts.ts";
import {
  assertClosedDeleteReferenceGraph,
  parseMarkdownDeleteReferences,
} from "./delete-reference-parser.ts";
import {
  acquireContentLifecycleLock,
  assertContentLifecycleLock,
  releaseContentLifecycleLock,
} from "./content-lifecycle-lock.ts";
import { isContentId } from "./content-id.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";
import { assertNoActiveRenameEvidence } from "./content-rename-evidence-lifecycle.ts";

const execFile = promisify(execFileCallback);
const POLICY_COMMIT = "fe2d6fe2c1c5ff5ce1bf255af8207bfa43681971";
const ADAPTER_VERSION = "artists-three-file-delete-v2" as const;
const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export type ArtistsDeletePlan = {
  schemaVersion: 1;
  adapterVersion: typeof ADAPTER_VERSION;
  operation: "artists-delete";
  operationId: string;
  contentId: string;
  routes: string[];
  repositoryHead: string;
  repositoryBranch: string;
  backupRoot: string;
  backupProof: Awaited<ReturnType<typeof provePreDeleteBackup>>;
  preimages: DeletePreimage[];
  recoveryPaths: string[];
  incomingReferences: [];
  retainedAssets: string[];
  planHash: string;
};

export class ArtistsDeleteError extends Error {
  readonly code:
    | "invalid-content-id"
    | "source-unavailable"
    | "backup-proof-required"
    | "backup-proof-stale"
    | "incoming-reference"
    | "parser-uncertainty"
    | "plan-stale"
    | "state-mismatch"
    | "lock-conflict"
    | "rollback-failed"
    | "unsafe-repository"
    | "delete-failed"
    | "publish-failed"
    | "pending-hero-publish-evidence"
    | "pending-rename-evidence";
  constructor(
    message: string,
    code: ArtistsDeleteError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArtistsDeleteError";
    this.code = code;
  }
}

const hashPlan = (plan: Omit<ArtistsDeletePlan, "planHash">) =>
  sha256(JSON.stringify(plan));
const relative = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join("/");

async function repositoryIdentity(repositoryRoot: string) {
  try {
    const real = await fs.realpath(repositoryRoot);
    const gitRoot = await execFile("git", ["rev-parse", "--show-toplevel"], {
      cwd: real,
      encoding: "utf8",
    }).then(({ stdout }) => fs.realpath(stdout.trim()));
    if (gitRoot !== real) throw new Error("root mismatch");
    const repositoryHead = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: real,
      encoding: "utf8",
    }).then(({ stdout }) => stdout.trim());
    const repositoryBranch = await execFile(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { cwd: real, encoding: "utf8" },
    ).then(({ stdout }) => stdout.trim());
    return { repositoryHead, repositoryBranch };
  } catch (error) {
    throw new ArtistsDeleteError(
      "Delete requires the exact repository root on an attached Git branch.",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function artistsInventory(repositoryRoot: string, contentId: string) {
  const root = path.join(repositoryRoot, "src/content/artists");
  const directory = path.resolve(root, contentId);
  if (path.dirname(directory) !== root)
    throw new ArtistsDeleteError(
      "Unsafe Artists source.",
      "source-unavailable",
    );
  const stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new ArtistsDeleteError(
      "Artists source is unavailable.",
      "source-unavailable",
    );
  const entry = await readArtistsEditorEntry(contentId, root).catch(
    () => undefined,
  );
  if (!entry || entry.structuralStatus !== "valid" || entry.issues.length)
    throw new ArtistsDeleteError(
      "Artists file must pass canonical validation before Delete.",
      "source-unavailable",
    );
  const names = await fs.readdir(directory, { withFileTypes: true });
  if (
    names.length !== 3 ||
    names.some(
      (item) =>
        item.isSymbolicLink() ||
        !item.isFile() ||
        !["index.yaml", "ja.md", "en.md"].includes(item.name),
    )
  )
    throw new ArtistsDeleteError(
      "Artists unit inventory is unsafe.",
      "source-unavailable",
    );
  return Promise.all(
    ["index.yaml", "ja.md", "en.md"].map(async (name) => {
      const file = path.join(directory, name);
      const bytes = await fs.readFile(file);
      return {
        path: relative(repositoryRoot, file),
        sha256: sha256(bytes),
        byteSize: bytes.byteLength,
      };
    }),
  );
}

async function assertNoIncomingReferences(
  repositoryRoot: string,
  contentId: string,
) {
  const contentRoot = path.join(repositoryRoot, "src/content");
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new ArtistsDeleteError(
          `Reference inventory encountered a symlink: ${relative(repositoryRoot, file)}`,
          "parser-uncertainty",
        );
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        if (!/\.(md|ya?ml)$/.test(entry.name))
          throw new ArtistsDeleteError(
            `Unsupported canonical reference source: ${relative(repositoryRoot, file)}`,
            "parser-uncertainty",
          );
        const text = await fs.readFile(file, "utf8");
        const canonicalPath = relative(repositoryRoot, file);
        const referenced = (message: string) => {
          throw new ArtistsDeleteError(
            `${message}: ${canonicalPath}`,
            "incoming-reference",
          );
        };
        try {
          if (canonicalPath.startsWith("src/content/works/")) {
            if (entry.name !== "index.yaml") continue;
            const item = await readWorksEditorEntry(
              path.basename(path.dirname(file)),
              path.dirname(path.dirname(file)),
            );
            if (item.structuralStatus !== "valid" || !item.data)
              throw new Error("invalid Work reference source");
            if (item.data.artist.id === contentId)
              referenced("Incoming Work.artist reference blocks Delete");
          } else if (canonicalPath.startsWith("src/content/exhibitions/")) {
            if (entry.name !== "index.yaml") continue;
            const item = await readExhibitionsEditorEntry(
              path.basename(path.dirname(file)),
              path.dirname(path.dirname(file)),
            );
            if (item.structuralStatus !== "valid" || !item.data)
              throw new Error("invalid Exhibition reference source");
            if (item.data.artists.some((value) => value.id === contentId))
              referenced(
                "Incoming Exhibitions.artists[] reference blocks Delete",
              );
          } else if (
            canonicalPath.startsWith("src/content/news/") &&
            entry.name === "index.yaml"
          ) {
            const item = await readNewsEditorEntry(
              path.basename(path.dirname(file)),
              path.dirname(path.dirname(file)),
            );
            if (item.structuralStatus !== "valid" || !item.data)
              throw new Error("invalid News reference source");
            if (
              item.data.link &&
              classifyArtistRoute(item.data.link, contentId)
            )
              referenced("Incoming News.link reference blocks Delete");
          }
        } catch (error) {
          if (error instanceof ArtistsDeleteError) throw error;
          throw new ArtistsDeleteError(
            `Typed reference parser could not close ${canonicalPath}.`,
            "parser-uncertainty",
            { cause: error },
          );
        }
        if (entry.name.endsWith(".md")) {
          try {
            const references = assertClosedDeleteReferenceGraph(
              parseMarkdownDeleteReferences(text),
            );
            if (
              references.some(
                (item) =>
                  item.target?.collection === "artists" &&
                  item.target.contentId === contentId,
              )
            )
              throw new ArtistsDeleteError(
                `Incoming Artist reference blocks Delete: ${relative(repositoryRoot, file)}`,
                "incoming-reference",
              );
          } catch (error) {
            if (error instanceof ArtistsDeleteError) throw error;
            throw new ArtistsDeleteError(
              `Reference parser could not close ${relative(repositoryRoot, file)}.`,
              "parser-uncertainty",
              { cause: error },
            );
          }
        }
        // The finalized Artist reference adapter defines News `link` values
        // as supported incoming references. Match frontmatter route tokens too.
        const escapedId = contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const unresolvedRoute = new RegExp(
          `(?:^|[\\s"'(:])\\/artists\\/${escapedId}\\/?(?:[?#][^\\s"')]+)?(?=$|[\\s"')])`,
          "m",
        );
        if (unresolvedRoute.test(text))
          throw new ArtistsDeleteError(
            `Incoming Artist reference blocks Delete: ${relative(repositoryRoot, file)}`,
            "incoming-reference",
          );
        const unresolvedTarget = new RegExp(
          `(?:^|[\\s"'(:])\\/artists\\/${escapedId}`,
          "m",
        );
        if (unresolvedTarget.test(text))
          throw new ArtistsDeleteError(
            `Unresolved Artist reference blocks Delete: ${relative(repositoryRoot, file)}`,
            "parser-uncertainty",
          );
      } else
        throw new ArtistsDeleteError(
          "Reference inventory is incomplete.",
          "parser-uncertainty",
        );
    }
  };
  await visit(contentRoot).catch((error) => {
    if (error instanceof ArtistsDeleteError) throw error;
    throw new ArtistsDeleteError(
      "The full canonical reference graph could not be read.",
      "parser-uncertainty",
      { cause: error },
    );
  });
}

function classifyArtistRoute(value: string, contentId: string) {
  const escaped = contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^/artists/${escaped}/?(?:[?#].*)?$`).test(value);
}

export async function planArtistsDelete(input: {
  repositoryRoot?: string;
  contentId: string;
  backupRoot: string;
}): Promise<ArtistsDeletePlan> {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  if (!isContentId(input.contentId))
    throw new ArtistsDeleteError(
      "Invalid Artists Content ID.",
      "invalid-content-id",
    );
  try {
    await assertNoActiveRenameEvidence(repositoryRoot, "artists", input.contentId);
  } catch (error) {
    throw new ArtistsDeleteError("Publish the active Artist Rename before Delete.", "pending-rename-evidence", { cause: error });
  }
  if (
    await new HeroAssetPublishEvidenceStore(repositoryRoot).read(
      "artists",
      input.contentId,
    )
  )
    throw new ArtistsDeleteError(
      "Publish the pending Artist Hero asset before Delete.",
      "pending-hero-publish-evidence",
    );
  if (!input.backupRoot?.trim())
    throw new ArtistsDeleteError(
      "Select a verified pre-delete backup generation before review.",
      "backup-proof-required",
    );
  const preimages = await artistsInventory(repositoryRoot, input.contentId);
  let backupProof;
  try {
    backupProof = await provePreDeleteBackup({
      backupRoot: path.resolve(input.backupRoot),
      sourcePreimages: preimages,
      policyCommit: POLICY_COMMIT,
    });
  } catch (error) {
    throw new ArtistsDeleteError(
      "Backup generation is missing, invalid, or does not contain the exact current Artists bytes.",
      "backup-proof-stale",
      { cause: error },
    );
  }
  await assertNoIncomingReferences(repositoryRoot, input.contentId);
  const identity = await repositoryIdentity(repositoryRoot);
  const operationId = randomUUID();
  const recoveryPaths = preimages.map((item) =>
    path.posix.join(
      ".kiki-editor/content-lifecycle/recovery",
      operationId,
      item.path,
    ),
  );
  const body: Omit<ArtistsDeletePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: ADAPTER_VERSION,
    operation: "artists-delete",
    operationId,
    contentId: input.contentId,
    routes: [`/artists/${input.contentId}/`],
    ...identity,
    backupRoot: path.resolve(input.backupRoot),
    backupProof,
    preimages,
    recoveryPaths,
    incomingReferences: [],
    retainedAssets: [],
  };
  return { ...body, planHash: hashPlan(body) };
}

function assertPlanIdentity(plan: ArtistsDeletePlan) {
  const body = { ...plan } as Partial<ArtistsDeletePlan>;
  delete body.planHash;
  if (plan.planHash !== hashPlan(body as Omit<ArtistsDeletePlan, "planHash">))
    throw new ArtistsDeleteError(
      "Delete plan identity is invalid.",
      "state-mismatch",
    );
}

const recordFor = (
  plan: ArtistsDeletePlan,
  state: ContentRecoveryRecord["state"],
): ContentRecoveryRecord => ({
  schemaVersion: 1,
  operation: "content-delete",
  operationId: plan.operationId,
  collection: "artists",
  contentId: plan.contentId,
  state,
  planHash: plan.planHash,
  repositoryHead: plan.repositoryHead,
  backupProof: plan.backupProof,
  preimages: plan.preimages,
  recoveryPaths: plan.recoveryPaths,
  publishPaths: plan.preimages.map((item) => item.path),
  preparedAt: new Date().toISOString(),
});

export async function executeArtistsDelete(
  reviewedPlan: ArtistsDeletePlan,
  repositoryRoot = path.resolve("."),
  testHooks?: {
    afterMove?: () => Promise<void>;
    beforeRollback?: () => Promise<void>;
  },
) {
  try {
    await assertNoActiveRenameEvidence(repositoryRoot, "artists", reviewedPlan.contentId);
  } catch (error) {
    throw new ArtistsDeleteError("Publish the active Artist Rename before Delete.", "pending-rename-evidence", { cause: error });
  }
  repositoryRoot = path.resolve(repositoryRoot);
  assertPlanIdentity(reviewedPlan);
  if (
    await new HeroAssetPublishEvidenceStore(repositoryRoot).read(
      "artists",
      reviewedPlan.contentId,
    )
  )
    throw new ArtistsDeleteError(
      "Publish the pending Artist Hero asset before Delete.",
      "pending-hero-publish-evidence",
    );
  let rebuilt: ArtistsDeletePlan;
  try {
    rebuilt = await planArtistsDelete({
      repositoryRoot,
      contentId: reviewedPlan.contentId,
      backupRoot: reviewedPlan.backupRoot,
    });
  } catch (error) {
    if (
      error instanceof ArtistsDeleteError &&
      (error.code === "incoming-reference" ||
        error.code === "parser-uncertainty")
    )
      throw error;
    throw new ArtistsDeleteError(
      "Canonical bytes, backup proof, or Git basis changed after review.",
      "plan-stale",
      { cause: error },
    );
  }
  const comparable = (plan: ArtistsDeletePlan) => ({
    ...plan,
    operationId: "reviewed",
    planHash: "",
    backupProof: { ...plan.backupProof, verifiedAt: "reviewed" },
    recoveryPaths: plan.recoveryPaths.map((value) =>
      value.replace(plan.operationId, "reviewed"),
    ),
  });
  if (
    JSON.stringify(comparable(rebuilt)) !==
    JSON.stringify(comparable(reviewedPlan))
  )
    throw new ArtistsDeleteError(
      "Canonical bytes, backup proof, references, or Git basis changed after review.",
      "plan-stale",
    );
  let lock;
  try {
    lock = await acquireContentLifecycleLock({
      repositoryRoot,
      writer: "delete",
      operationId: reviewedPlan.operationId,
    });
  } catch (error) {
    throw new ArtistsDeleteError(
      "Another content lifecycle operation is active or requires reconciliation.",
      "lock-conflict",
      { cause: error },
    );
  }
  let record = recordFor(reviewedPlan, "prepared");
  const canonicalFile = path.join(
    repositoryRoot,
    "src/content/artists",
    reviewedPlan.contentId,
  );
  const recoveryFile = path.dirname(
    path.join(repositoryRoot, reviewedPlan.recoveryPaths[0]),
  );
  let moved = false;
  try {
    await assertContentLifecycleLock(repositoryRoot, lock.identity);
    const current = await artistsInventory(
      repositoryRoot,
      reviewedPlan.contentId,
    );
    if (JSON.stringify(current) !== JSON.stringify(reviewedPlan.preimages))
      throw new ArtistsDeleteError(
        "Artists bytes drifted after lock acquisition.",
        "plan-stale",
      );
    await assertNoIncomingReferences(repositoryRoot, reviewedPlan.contentId);
    if (await fs.lstat(recoveryFile).catch(() => undefined))
      throw new ArtistsDeleteError(
        "Recovery destination already exists.",
        "state-mismatch",
      );
    await fs.mkdir(path.dirname(recoveryFile), {
      recursive: true,
      mode: 0o700,
    });
    await persistContentRecoveryRecord(repositoryRoot, record);
    await fs.rename(canonicalFile, recoveryFile);
    moved = true;
    await testHooks?.afterMove?.();
    if (await fs.lstat(canonicalFile).catch(() => undefined))
      throw new ArtistsDeleteError(
        "Canonical Artists unit remained after Delete.",
        "state-mismatch",
      );
    record = {
      ...record,
      state: "completed",
      completedAt: new Date().toISOString(),
    };
    await persistContentRecoveryRecord(repositoryRoot, record);
    await releaseContentLifecycleLock(repositoryRoot, lock.identity);
    return {
      operationId: reviewedPlan.operationId,
      state: "deleted-unpublished" as const,
    };
  } catch (error) {
    try {
      await testHooks?.beforeRollback?.();
      if (moved) {
        if (await fs.lstat(canonicalFile).catch(() => undefined))
          throw new Error("canonical destination was recreated");
        await fs.rename(recoveryFile, canonicalFile);
        const restored = await artistsInventory(
          repositoryRoot,
          reviewedPlan.contentId,
        );
        if (JSON.stringify(restored) !== JSON.stringify(reviewedPlan.preimages))
          throw new Error("restored bytes mismatch");
      }
      record = {
        ...record,
        state: "rolled-back",
        resolution: {
          at: new Date().toISOString(),
          reason: error instanceof Error ? error.message : "Delete failed",
        },
      };
      await persistContentRecoveryRecord(repositoryRoot, record);
      await releaseContentLifecycleLock(repositoryRoot, lock.identity);
    } catch (rollbackError) {
      await persistContentRecoveryRecord(repositoryRoot, {
        ...record,
        state: "manual-recovery-required",
        resolution: {
          at: new Date().toISOString(),
          reason: "Rollback could not prove restoration of all original bytes",
        },
      }).catch(() => undefined);
      throw new ArtistsDeleteError(
        "Artists Delete rollback failed; preserve the lock and inspect recovery evidence.",
        "rollback-failed",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    if (error instanceof ArtistsDeleteError) throw error;
    throw new ArtistsDeleteError(
      "Artists Delete failed and was rolled back.",
      "delete-failed",
      { cause: error },
    );
  }
}

export async function publishArtistsDelete(
  operationId: string,
  repositoryRoot = path.resolve("."),
) {
  if (!/^[0-9a-f-]{36}$/i.test(operationId))
    throw new ArtistsDeleteError(
      "Invalid Delete evidence identity.",
      "state-mismatch",
    );
  const evidenceFile = path.join(
    repositoryRoot,
    ".kiki-editor/content-lifecycle/operations",
    operationId,
    "operation.json",
  );
  let record: ContentRecoveryRecord;
  try {
    record = JSON.parse(await fs.readFile(evidenceFile, "utf8"));
  } catch (error) {
    throw new ArtistsDeleteError(
      "Completed Delete evidence is unavailable.",
      "state-mismatch",
      { cause: error },
    );
  }
  if (record.collection !== "artists")
    throw new ArtistsDeleteError(
      "Delete evidence does not belong to Artists.",
      "state-mismatch",
    );
  const files = plannedDeletePublishPaths(record);
  const git = async (args: string[]) =>
    execFile("git", args, { cwd: repositoryRoot, encoding: "utf8" }).then(
      ({ stdout }) => stdout.trim(),
    );
  if (await git(["diff", "--cached", "--name-only"]))
    throw new ArtistsDeleteError(
      "Publish requires a clean Git index.",
      "state-mismatch",
    );
  if (
    (await git(["rev-parse", "HEAD"])) !== record.repositoryHead ||
    !(await git(["symbolic-ref", "--quiet", "--short", "HEAD"]))
  )
    throw new ArtistsDeleteError(
      "Repository identity changed after the completed Delete.",
      "state-mismatch",
    );
  if (
    files.some(
      (file) =>
        !["index.yaml", "ja.md", "en.md"]
          .map((name) => `src/content/artists/${record.contentId}/${name}`)
          .includes(file),
    )
  )
    throw new ArtistsDeleteError(
      "Delete evidence escaped the Artists unit.",
      "state-mismatch",
    );
  try {
    await git(["add", "-A", "--", ...files]);
    const staged = (await git(["diff", "--cached", "--name-only"]))
      .split("\n")
      .filter(Boolean)
      .sort();
    if (JSON.stringify(staged) !== JSON.stringify([...files].sort()))
      throw new ArtistsDeleteError(
        "Staged paths do not exactly match completed Delete evidence.",
        "state-mismatch",
      );
    const status = await Promise.all(
      files.map((file) =>
        git(["diff", "--cached", "--name-status", "--", file]),
      ),
    );
    if (status.some((line) => !line.startsWith("D\t")))
      throw new ArtistsDeleteError(
        "Delete Publish requires exact staged deletions.",
        "state-mismatch",
      );
    await git(["commit", "-m", `Delete artists: ${record.contentId}`]);
    return {
      state: "committed" as const,
      commit: await git(["rev-parse", "HEAD"]),
      files,
    };
  } catch (error) {
    await git(["reset", "--", ...files]).catch(() => undefined);
    if (error instanceof ArtistsDeleteError) throw error;
    throw new ArtistsDeleteError(
      "Failed to publish Artists Delete.",
      "publish-failed",
      { cause: error },
    );
  }
}
