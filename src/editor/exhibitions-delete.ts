import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
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
const ADAPTER_VERSION = "exhibitions-delete-v1" as const;
const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export type ExhibitionsDeletePlan = {
  schemaVersion: 1;
  adapterVersion: typeof ADAPTER_VERSION;
  operation: "exhibitions-delete";
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

export class ExhibitionsDeleteError extends Error {
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
    code: ExhibitionsDeleteError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExhibitionsDeleteError";
    this.code = code;
  }
}

const hashPlan = (plan: Omit<ExhibitionsDeletePlan, "planHash">) =>
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
    throw new ExhibitionsDeleteError(
      "Delete requires the exact repository root on an attached Git branch.",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function exhibitionsInventory(repositoryRoot: string, contentId: string) {
  const root = path.join(repositoryRoot, "src/content/exhibitions");
  const file = path.resolve(root, `${contentId}.md`);
  if (path.dirname(file) !== root)
    throw new ExhibitionsDeleteError(
      "Unsafe Exhibitions source.",
      "source-unavailable",
    );
  const stat = await fs.lstat(file).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new ExhibitionsDeleteError(
      "Exhibitions source is unavailable.",
      "source-unavailable",
    );
  const entry = await readExhibitionsEditorEntry(contentId, root).catch(
    () => undefined,
  );
  if (!entry || entry.structuralStatus !== "valid" || entry.issues.length)
    throw new ExhibitionsDeleteError(
      "Exhibitions file must pass canonical validation before Delete.",
      "source-unavailable",
    );
  const bytes = await fs.readFile(file);
  return [
    {
      path: relative(repositoryRoot, file),
      sha256: sha256(bytes),
      byteSize: bytes.byteLength,
    },
  ];
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
        throw new ExhibitionsDeleteError(
          `Reference inventory encountered a symlink: ${relative(repositoryRoot, file)}`,
          "parser-uncertainty",
        );
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        if (!/\.(md|ya?ml)$/.test(entry.name))
          throw new ExhibitionsDeleteError(
            `Unsupported canonical reference source: ${relative(repositoryRoot, file)}`,
            "parser-uncertainty",
          );
        const text = await fs.readFile(file, "utf8");
        if (entry.name.endsWith(".md")) {
          try {
            const references = assertClosedDeleteReferenceGraph(
              parseMarkdownDeleteReferences(text),
            );
            if (
              references.some(
                (item) =>
                  item.target?.collection === "exhibitions" &&
                  item.target.contentId === contentId,
              )
            )
              throw new ExhibitionsDeleteError(
                `Incoming Exhibition reference blocks Delete: ${relative(repositoryRoot, file)}`,
                "incoming-reference",
              );
          } catch (error) {
            if (error instanceof ExhibitionsDeleteError) throw error;
            throw new ExhibitionsDeleteError(
              `Reference parser could not close ${relative(repositoryRoot, file)}.`,
              "parser-uncertainty",
              { cause: error },
            );
          }
        }
        // The finalized Exhibition reference adapter defines News `link` values
        // as supported incoming references. Match frontmatter route tokens too.
        const escapedId = contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const unresolvedRoute = new RegExp(
          `(?:^|[\\s"'(:])\\/exhibitions\\/${escapedId}\\/?(?:[?#][^\\s"')]+)?(?=$|[\\s"')])`,
          "m",
        );
        if (unresolvedRoute.test(text))
          throw new ExhibitionsDeleteError(
            `Incoming Exhibition reference blocks Delete: ${relative(repositoryRoot, file)}`,
            "incoming-reference",
          );
        const unresolvedTarget = new RegExp(
          `(?:^|[\\s"'(:])\\/exhibitions\\/${escapedId}`,
          "m",
        );
        if (unresolvedTarget.test(text))
          throw new ExhibitionsDeleteError(
            `Unresolved Exhibition reference blocks Delete: ${relative(repositoryRoot, file)}`,
            "parser-uncertainty",
          );
      } else
        throw new ExhibitionsDeleteError(
          "Reference inventory is incomplete.",
          "parser-uncertainty",
        );
    }
  };
  await visit(contentRoot).catch((error) => {
    if (error instanceof ExhibitionsDeleteError) throw error;
    throw new ExhibitionsDeleteError(
      "The full canonical reference graph could not be read.",
      "parser-uncertainty",
      { cause: error },
    );
  });
}

export async function planExhibitionsDelete(input: {
  repositoryRoot?: string;
  contentId: string;
  backupRoot: string;
}): Promise<ExhibitionsDeletePlan> {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  if (!isContentId(input.contentId))
    throw new ExhibitionsDeleteError(
      "Invalid Exhibitions Content ID.",
      "invalid-content-id",
    );
  if (!input.backupRoot?.trim())
    throw new ExhibitionsDeleteError(
      "Select a verified pre-delete backup generation before review.",
      "backup-proof-required",
    );
  const preimages = await exhibitionsInventory(repositoryRoot, input.contentId);
  let backupProof;
  try {
    backupProof = await provePreDeleteBackup({
      backupRoot: path.resolve(input.backupRoot),
      sourcePreimages: preimages,
      policyCommit: POLICY_COMMIT,
    });
  } catch (error) {
    throw new ExhibitionsDeleteError(
      "Backup generation is missing, invalid, or does not contain the exact current Exhibitions bytes.",
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
  const body: Omit<ExhibitionsDeletePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: ADAPTER_VERSION,
    operation: "exhibitions-delete",
    operationId,
    contentId: input.contentId,
    routes: [`/exhibitions/${input.contentId}/`],
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

function assertPlanIdentity(plan: ExhibitionsDeletePlan) {
  const body = { ...plan } as Partial<ExhibitionsDeletePlan>;
  delete body.planHash;
  if (
    plan.planHash !== hashPlan(body as Omit<ExhibitionsDeletePlan, "planHash">)
  )
    throw new ExhibitionsDeleteError(
      "Delete plan identity is invalid.",
      "state-mismatch",
    );
}

const recordFor = (
  plan: ExhibitionsDeletePlan,
  state: ContentRecoveryRecord["state"],
): ContentRecoveryRecord => ({
  schemaVersion: 1,
  operation: "content-delete",
  operationId: plan.operationId,
  collection: "exhibitions",
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

export async function executeExhibitionsDelete(
  reviewedPlan: ExhibitionsDeletePlan,
  repositoryRoot = path.resolve("."),
  testHooks?: {
    afterMove?: () => Promise<void>;
    beforeRollback?: () => Promise<void>;
  },
) {
  repositoryRoot = path.resolve(repositoryRoot);
  assertPlanIdentity(reviewedPlan);
  let rebuilt: ExhibitionsDeletePlan;
  try {
    rebuilt = await planExhibitionsDelete({
      repositoryRoot,
      contentId: reviewedPlan.contentId,
      backupRoot: reviewedPlan.backupRoot,
    });
  } catch (error) {
    if (
      error instanceof ExhibitionsDeleteError &&
      (error.code === "incoming-reference" ||
        error.code === "parser-uncertainty")
    )
      throw error;
    throw new ExhibitionsDeleteError(
      "Canonical bytes, backup proof, or Git basis changed after review.",
      "plan-stale",
      { cause: error },
    );
  }
  const comparable = (plan: ExhibitionsDeletePlan) => ({
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
    throw new ExhibitionsDeleteError(
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
    throw new ExhibitionsDeleteError(
      "Another content lifecycle operation is active or requires reconciliation.",
      "lock-conflict",
      { cause: error },
    );
  }
  let record = recordFor(reviewedPlan, "prepared");
  const canonicalFile = path.join(
    repositoryRoot,
    "src/content/exhibitions",
    `${reviewedPlan.contentId}.md`,
  );
  const recoveryFile = path.join(repositoryRoot, reviewedPlan.recoveryPaths[0]);
  let moved = false;
  try {
    await assertContentLifecycleLock(repositoryRoot, lock.identity);
    const current = await exhibitionsInventory(
      repositoryRoot,
      reviewedPlan.contentId,
    );
    if (JSON.stringify(current) !== JSON.stringify(reviewedPlan.preimages))
      throw new ExhibitionsDeleteError(
        "Exhibitions bytes drifted after lock acquisition.",
        "plan-stale",
      );
    await assertNoIncomingReferences(repositoryRoot, reviewedPlan.contentId);
    if (await fs.lstat(recoveryFile).catch(() => undefined))
      throw new ExhibitionsDeleteError(
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
      throw new ExhibitionsDeleteError(
        "Canonical Exhibitions unit remained after Delete.",
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
        const restored = await exhibitionsInventory(
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
      throw new ExhibitionsDeleteError(
        "Exhibitions Delete rollback failed; preserve the lock and inspect recovery evidence.",
        "rollback-failed",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    if (error instanceof ExhibitionsDeleteError) throw error;
    throw new ExhibitionsDeleteError(
      "Exhibitions Delete failed and was rolled back.",
      "delete-failed",
      { cause: error },
    );
  }
}

export async function publishExhibitionsDelete(
  operationId: string,
  repositoryRoot = path.resolve("."),
) {
  if (!/^[0-9a-f-]{36}$/i.test(operationId))
    throw new ExhibitionsDeleteError(
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
    throw new ExhibitionsDeleteError(
      "Completed Delete evidence is unavailable.",
      "state-mismatch",
      { cause: error },
    );
  }
  if (record.collection !== "exhibitions")
    throw new ExhibitionsDeleteError(
      "Delete evidence does not belong to Exhibitions.",
      "state-mismatch",
    );
  const files = plannedDeletePublishPaths(record);
  const git = async (args: string[]) =>
    execFile("git", args, { cwd: repositoryRoot, encoding: "utf8" }).then(
      ({ stdout }) => stdout.trim(),
    );
  if (await git(["diff", "--cached", "--name-only"]))
    throw new ExhibitionsDeleteError(
      "Publish requires a clean Git index.",
      "state-mismatch",
    );
  if (
    (await git(["rev-parse", "HEAD"])) !== record.repositoryHead ||
    !(await git(["symbolic-ref", "--quiet", "--short", "HEAD"]))
  )
    throw new ExhibitionsDeleteError(
      "Repository identity changed after the completed Delete.",
      "state-mismatch",
    );
  if (
    files.some(
      (file) => file !== `src/content/exhibitions/${record.contentId}.md`,
    )
  )
    throw new ExhibitionsDeleteError(
      "Delete evidence escaped the Exhibitions unit.",
      "state-mismatch",
    );
  try {
    await git(["add", "-A", "--", ...files]);
    const staged = (await git(["diff", "--cached", "--name-only"]))
      .split("\n")
      .filter(Boolean)
      .sort();
    if (JSON.stringify(staged) !== JSON.stringify([...files].sort()))
      throw new ExhibitionsDeleteError(
        "Staged paths do not exactly match completed Delete evidence.",
        "state-mismatch",
      );
    const status = await Promise.all(
      files.map((file) =>
        git(["diff", "--cached", "--name-status", "--", file]),
      ),
    );
    if (status.some((line) => !line.startsWith("D\t")))
      throw new ExhibitionsDeleteError(
        "Delete Publish requires one staged deletion.",
        "state-mismatch",
      );
    await git(["commit", "-m", `Delete exhibitions: ${record.contentId}`]);
    return {
      state: "committed" as const,
      commit: await git(["rev-parse", "HEAD"]),
      files,
    };
  } catch (error) {
    await git(["reset", "--", ...files]).catch(() => undefined);
    if (error instanceof ExhibitionsDeleteError) throw error;
    throw new ExhibitionsDeleteError(
      "Failed to publish Exhibitions Delete.",
      "publish-failed",
      { cause: error },
    );
  }
}
