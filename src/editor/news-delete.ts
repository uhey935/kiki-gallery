import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

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

const execFile = promisify(execFileCallback);
const POLICY_COMMIT = "fe2d6fe2c1c5ff5ce1bf255af8207bfa43681971";
const ADAPTER_VERSION = "news-delete-v1" as const;
const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export type NewsDeletePlan = {
  schemaVersion: 1;
  adapterVersion: typeof ADAPTER_VERSION;
  operation: "news-delete";
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

export class NewsDeleteError extends Error {
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
    | "publish-failed";
  constructor(
    message: string,
    code: NewsDeleteError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NewsDeleteError";
    this.code = code;
  }
}

const hashPlan = (plan: Omit<NewsDeletePlan, "planHash">) =>
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
    throw new NewsDeleteError(
      "Delete requires the exact repository root on an attached Git branch.",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function newsInventory(repositoryRoot: string, contentId: string) {
  const root = path.join(repositoryRoot, "src/content/news");
  const file = path.resolve(root, contentId);
  if (path.dirname(file) !== root)
    throw new NewsDeleteError("Unsafe News source.", "source-unavailable");
  const stat = await fs.lstat(file).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new NewsDeleteError(
      "News source is unavailable.",
      "source-unavailable",
    );
  const entry = await readNewsEditorEntry(contentId, root).catch(
    () => undefined,
  );
  if (!entry || entry.structuralStatus !== "valid" || entry.issues.length)
    throw new NewsDeleteError(
      "News file must pass canonical validation before Delete.",
      "source-unavailable",
    );
  const names = (await fs.readdir(file)).sort();
  if (
    JSON.stringify(names) !== JSON.stringify(["en.md", "index.yaml", "ja.md"])
  )
    throw new NewsDeleteError(
      "News Delete requires exactly index.yaml, ja.md, and en.md.",
      "source-unavailable",
    );
  return Promise.all(
    names.map(async (name) => {
      const source = path.join(file, name);
      const sourceStat = await fs.lstat(source);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
        throw new NewsDeleteError("Unsafe News source.", "source-unavailable");
      const bytes = await fs.readFile(source);
      return {
        path: relative(repositoryRoot, source),
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
        throw new NewsDeleteError(
          `Reference inventory encountered a symlink: ${relative(repositoryRoot, file)}`,
          "parser-uncertainty",
        );
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        if (!/\.(md|ya?ml)$/.test(entry.name))
          throw new NewsDeleteError(
            `Unsupported canonical reference source: ${relative(repositoryRoot, file)}`,
            "parser-uncertainty",
          );
        const text = await fs.readFile(file, "utf8");
        if (entry.name.endsWith(".md")) {
          try {
            assertClosedDeleteReferenceGraph(
              parseMarkdownDeleteReferences(text),
            );
          } catch (error) {
            throw new NewsDeleteError(
              `Reference parser could not close ${relative(repositoryRoot, file)}.`,
              "parser-uncertainty",
              { cause: error },
            );
          }
          // News has no public detail route in the current route registry.
          // Any News-looking internal route is therefore unresolved and the
          // closed-graph assertion above fails before deletion.
        }
        // Typed adapters currently expose no News-ID field. Any remaining
        // route token in canonical YAML/frontmatter is therefore unresolved.
        const escapedId = contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const unresolvedRoute = new RegExp(
          `(?:^|[\\s"'(:])\\/news\\/${escapedId}\\/?(?:[?#][^\\s"')]+)?(?=$|[\\s"')])`,
          "m",
        );
        if (entry.name.match(/ya?ml$/) && unresolvedRoute.test(text))
          throw new NewsDeleteError(
            `Unresolved typed News reference blocks Delete: ${relative(repositoryRoot, file)}`,
            "parser-uncertainty",
          );
      } else
        throw new NewsDeleteError(
          "Reference inventory is incomplete.",
          "parser-uncertainty",
        );
    }
  };
  await visit(contentRoot).catch((error) => {
    if (error instanceof NewsDeleteError) throw error;
    throw new NewsDeleteError(
      "The full canonical reference graph could not be read.",
      "parser-uncertainty",
      { cause: error },
    );
  });
}

export async function planNewsDelete(input: {
  repositoryRoot?: string;
  contentId: string;
  backupRoot: string;
}): Promise<NewsDeletePlan> {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  if (!isContentId(input.contentId))
    throw new NewsDeleteError("Invalid News Content ID.", "invalid-content-id");
  if (!input.backupRoot?.trim())
    throw new NewsDeleteError(
      "Select a verified pre-delete backup generation before review.",
      "backup-proof-required",
    );
  const preimages = await newsInventory(repositoryRoot, input.contentId);
  let backupProof;
  try {
    backupProof = await provePreDeleteBackup({
      backupRoot: path.resolve(input.backupRoot),
      sourcePreimages: preimages,
      policyCommit: POLICY_COMMIT,
    });
  } catch (error) {
    throw new NewsDeleteError(
      "Backup generation is missing, invalid, or does not contain the exact current News bytes.",
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
  const body: Omit<NewsDeletePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: ADAPTER_VERSION,
    operation: "news-delete",
    operationId,
    contentId: input.contentId,
    routes: [],
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

function assertPlanIdentity(plan: NewsDeletePlan) {
  const body = { ...plan } as Partial<NewsDeletePlan>;
  delete body.planHash;
  if (plan.planHash !== hashPlan(body as Omit<NewsDeletePlan, "planHash">))
    throw new NewsDeleteError(
      "Delete plan identity is invalid.",
      "state-mismatch",
    );
}

const recordFor = (
  plan: NewsDeletePlan,
  state: ContentRecoveryRecord["state"],
): ContentRecoveryRecord => ({
  schemaVersion: 1,
  operation: "content-delete",
  operationId: plan.operationId,
  collection: "news",
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

export async function executeNewsDelete(
  reviewedPlan: NewsDeletePlan,
  repositoryRoot = path.resolve("."),
  testHooks?: {
    afterMove?: () => Promise<void>;
    beforeRollback?: () => Promise<void>;
  },
) {
  repositoryRoot = path.resolve(repositoryRoot);
  assertPlanIdentity(reviewedPlan);
  let rebuilt: NewsDeletePlan;
  try {
    rebuilt = await planNewsDelete({
      repositoryRoot,
      contentId: reviewedPlan.contentId,
      backupRoot: reviewedPlan.backupRoot,
    });
  } catch (error) {
    if (
      error instanceof NewsDeleteError &&
      (error.code === "incoming-reference" ||
        error.code === "parser-uncertainty")
    )
      throw error;
    throw new NewsDeleteError(
      "Canonical bytes, backup proof, or Git basis changed after review.",
      "plan-stale",
      { cause: error },
    );
  }
  const comparable = (plan: NewsDeletePlan) => ({
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
    throw new NewsDeleteError(
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
    throw new NewsDeleteError(
      "Another content lifecycle operation is active or requires reconciliation.",
      "lock-conflict",
      { cause: error },
    );
  }
  let record = recordFor(reviewedPlan, "prepared");
  const canonicalFile = path.join(
    repositoryRoot,
    "src/content/news",
    reviewedPlan.contentId,
  );
  const recoveryFile = path.dirname(
    path.join(repositoryRoot, reviewedPlan.recoveryPaths[0]),
  );
  let moved = false;
  try {
    await assertContentLifecycleLock(repositoryRoot, lock.identity);
    const current = await newsInventory(repositoryRoot, reviewedPlan.contentId);
    if (JSON.stringify(current) !== JSON.stringify(reviewedPlan.preimages))
      throw new NewsDeleteError(
        "News bytes drifted after lock acquisition.",
        "plan-stale",
      );
    await assertNoIncomingReferences(repositoryRoot, reviewedPlan.contentId);
    if (await fs.lstat(recoveryFile).catch(() => undefined))
      throw new NewsDeleteError(
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
      throw new NewsDeleteError(
        "Canonical News unit remained after Delete.",
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
        const restored = await newsInventory(
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
      throw new NewsDeleteError(
        "News Delete rollback failed; preserve the lock and inspect recovery evidence.",
        "rollback-failed",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    if (error instanceof NewsDeleteError) throw error;
    throw new NewsDeleteError(
      "News Delete failed and was rolled back.",
      "delete-failed",
      { cause: error },
    );
  }
}

export async function publishNewsDelete(
  operationId: string,
  repositoryRoot = path.resolve("."),
) {
  if (!/^[0-9a-f-]{36}$/i.test(operationId))
    throw new NewsDeleteError(
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
    throw new NewsDeleteError(
      "Completed Delete evidence is unavailable.",
      "state-mismatch",
      { cause: error },
    );
  }
  if (record.collection !== "news")
    throw new NewsDeleteError(
      "Delete evidence does not belong to News.",
      "state-mismatch",
    );
  const files = plannedDeletePublishPaths(record);
  const git = async (args: string[]) =>
    execFile("git", args, { cwd: repositoryRoot, encoding: "utf8" }).then(
      ({ stdout }) => stdout.trim(),
    );
  if (await git(["diff", "--cached", "--name-only"]))
    throw new NewsDeleteError(
      "Publish requires a clean Git index.",
      "state-mismatch",
    );
  if (
    (await git(["rev-parse", "HEAD"])) !== record.repositoryHead ||
    !(await git(["symbolic-ref", "--quiet", "--short", "HEAD"]))
  )
    throw new NewsDeleteError(
      "Repository identity changed after the completed Delete.",
      "state-mismatch",
    );
  const expected = ["en.md", "index.yaml", "ja.md"]
    .map((name) => `src/content/news/${record.contentId}/${name}`)
    .sort();
  if (JSON.stringify([...files].sort()) !== JSON.stringify(expected))
    throw new NewsDeleteError(
      "Delete evidence escaped the News unit.",
      "state-mismatch",
    );
  try {
    await git(["add", "-A", "--", ...files]);
    const staged = (await git(["diff", "--cached", "--name-only"]))
      .split("\n")
      .filter(Boolean)
      .sort();
    if (JSON.stringify(staged) !== JSON.stringify([...files].sort()))
      throw new NewsDeleteError(
        "Staged paths do not exactly match completed Delete evidence.",
        "state-mismatch",
      );
    const status = await Promise.all(
      files.map((file) =>
        git(["diff", "--cached", "--name-status", "--", file]),
      ),
    );
    if (status.some((line) => !line.startsWith("D\t")))
      throw new NewsDeleteError(
        "Delete Publish requires three staged deletions.",
        "state-mismatch",
      );
    await git(["commit", "-m", `Delete news: ${record.contentId}`]);
    return {
      state: "committed" as const,
      commit: await git(["rev-parse", "HEAD"]),
      files,
    };
  } catch (error) {
    await git(["reset", "--", ...files]).catch(() => undefined);
    if (error instanceof NewsDeleteError) throw error;
    throw new NewsDeleteError(
      "Failed to publish News Delete.",
      "publish-failed",
      { cause: error },
    );
  }
}
