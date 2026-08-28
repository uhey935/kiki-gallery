import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { loadJournalUnit } from "../content-loaders/journal/repository.ts";
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
import { readNewsEditorEntry } from "./news-state.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";

const execFile = promisify(execFileCallback);
const FILES = ["index.yaml", "ja.md", "en.md"] as const;
const POLICY_COMMIT = "fe2d6fe2c1c5ff5ce1bf255af8207bfa43681971";
const ADAPTER_VERSION = "journal-delete-v1" as const;
const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export type JournalDeletePlan = {
  schemaVersion: 1;
  adapterVersion: typeof ADAPTER_VERSION;
  operation: "journal-delete";
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

export class JournalDeleteError extends Error {
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
    code: JournalDeleteError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JournalDeleteError";
    this.code = code;
  }
}

const hashPlan = (plan: Omit<JournalDeletePlan, "planHash">) =>
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
    throw new JournalDeleteError(
      "Delete requires the exact repository root on an attached Git branch.",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function journalInventory(repositoryRoot: string, contentId: string) {
  const root = path.join(repositoryRoot, "src/content/journal");
  const directory = path.resolve(root, contentId);
  if (path.dirname(directory) !== root)
    throw new JournalDeleteError(
      "Unsafe Journal source.",
      "source-unavailable",
    );
  const stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new JournalDeleteError(
      "Journal source is unavailable.",
      "source-unavailable",
    );
  const entries = (await fs.readdir(directory)).sort();
  if (JSON.stringify(entries) !== JSON.stringify([...FILES].sort()))
    throw new JournalDeleteError(
      "Journal Delete requires exactly index.yaml, ja.md, and en.md.",
      "source-unavailable",
    );
  const unit = await loadJournalUnit(directory);
  if (
    unit.issues.length ||
    unit.shared.state !== "valid" ||
    unit.locales.ja.state !== "valid" ||
    unit.locales.en.state !== "valid"
  )
    throw new JournalDeleteError(
      "Journal unit must pass canonical three-file validation before Delete.",
      "source-unavailable",
    );
  const preimages: DeletePreimage[] = [];
  for (const name of FILES) {
    const file = path.join(directory, name);
    const fileStat = await fs.lstat(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink())
      throw new JournalDeleteError(
        "Journal source contains an unsafe file.",
        "source-unavailable",
      );
    const bytes = await fs.readFile(file);
    preimages.push({
      path: relative(repositoryRoot, file),
      sha256: sha256(bytes),
      byteSize: bytes.byteLength,
    });
  }
  return preimages.sort((a, b) => a.path.localeCompare(b.path));
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
        throw new JournalDeleteError(
          `Reference inventory encountered a symlink: ${relative(repositoryRoot, file)}`,
          "parser-uncertainty",
        );
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        if (!/\.(md|ya?ml)$/.test(entry.name))
          throw new JournalDeleteError(
            `Unsupported canonical reference source: ${relative(repositoryRoot, file)}`,
            "parser-uncertainty",
          );
        const text = await fs.readFile(file, "utf8");
        const canonical = relative(repositoryRoot, file);
        if (
          canonical.startsWith("src/content/news/") &&
          entry.name === "index.yaml"
        ) {
          const item = await readNewsEditorEntry(
            path.basename(path.dirname(file)),
            path.dirname(path.dirname(file)),
          );
          if (item.structuralStatus !== "valid" || !item.data)
            throw new JournalDeleteError(
              `News reference source is invalid: ${canonical}`,
              "parser-uncertainty",
            );
          if (
            item.data.link &&
            new RegExp(`^/journal/${contentId}/?(?:[?#].*)?$`).test(
              item.data.link,
            )
          )
            throw new JournalDeleteError(
              `Incoming Journal reference blocks Delete: ${canonical}`,
              "incoming-reference",
            );
        }
        if (entry.name.endsWith(".md")) {
          let references;
          try {
            references = assertClosedDeleteReferenceGraph(
              parseMarkdownDeleteReferences(text),
            );
          } catch (error) {
            throw new JournalDeleteError(
              `Reference parser could not close ${relative(repositoryRoot, file)}.`,
              "parser-uncertainty",
              { cause: error },
            );
          }
          if (
            references.some(
              (item) =>
                item.target?.collection === "journal" &&
                item.target.contentId === contentId,
            )
          )
            throw new JournalDeleteError(
              `Incoming Journal reference blocks Delete: ${relative(repositoryRoot, file)}`,
              "incoming-reference",
            );
        }
        // Typed adapters currently expose no Journal-ID field. Any remaining
        // route token in canonical YAML/frontmatter is therefore unresolved.
        const escapedId = contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const unresolvedRoute = new RegExp(
          `(?:^|[\\s"'(:])\\/journal\\/${escapedId}\\/?(?:[?#][^\\s"')]+)?(?=$|[\\s"')])`,
          "m",
        );
        if (
          entry.name.match(/ya?ml$/) &&
          !canonical.startsWith("src/content/news/") &&
          unresolvedRoute.test(text)
        )
          throw new JournalDeleteError(
            `Unresolved typed Journal reference blocks Delete: ${relative(repositoryRoot, file)}`,
            "parser-uncertainty",
          );
      } else
        throw new JournalDeleteError(
          "Reference inventory is incomplete.",
          "parser-uncertainty",
        );
    }
  };
  await visit(contentRoot).catch((error) => {
    if (error instanceof JournalDeleteError) throw error;
    throw new JournalDeleteError(
      "The full canonical reference graph could not be read.",
      "parser-uncertainty",
      { cause: error },
    );
  });
}

export async function planJournalDelete(input: {
  repositoryRoot?: string;
  contentId: string;
  backupRoot: string;
}): Promise<JournalDeletePlan> {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  if (
    await new HeroAssetPublishEvidenceStore(repositoryRoot).read(
      "journal",
      input.contentId,
    )
  )
    throw new JournalDeleteError(
      "Publish the pending Journal Hero asset before Delete.",
      "state-mismatch",
    );
  if (!isContentId(input.contentId))
    throw new JournalDeleteError(
      "Invalid Journal Content ID.",
      "invalid-content-id",
    );
  if (!input.backupRoot?.trim())
    throw new JournalDeleteError(
      "Select a verified pre-delete backup generation before review.",
      "backup-proof-required",
    );
  const preimages = await journalInventory(repositoryRoot, input.contentId);
  let backupProof;
  try {
    backupProof = await provePreDeleteBackup({
      backupRoot: path.resolve(input.backupRoot),
      sourcePreimages: preimages,
      policyCommit: POLICY_COMMIT,
    });
  } catch (error) {
    throw new JournalDeleteError(
      "Backup generation is missing, invalid, or does not contain the exact current Journal bytes.",
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
  const body: Omit<JournalDeletePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: ADAPTER_VERSION,
    operation: "journal-delete",
    operationId,
    contentId: input.contentId,
    routes: [`/journal/${input.contentId}/`],
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

function assertPlanIdentity(plan: JournalDeletePlan) {
  const body = { ...plan } as Partial<JournalDeletePlan>;
  delete body.planHash;
  if (plan.planHash !== hashPlan(body as Omit<JournalDeletePlan, "planHash">))
    throw new JournalDeleteError(
      "Delete plan identity is invalid.",
      "state-mismatch",
    );
}

const recordFor = (
  plan: JournalDeletePlan,
  state: ContentRecoveryRecord["state"],
): ContentRecoveryRecord => ({
  schemaVersion: 1,
  operation: "content-delete",
  operationId: plan.operationId,
  collection: "journal",
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

export async function executeJournalDelete(
  reviewedPlan: JournalDeletePlan,
  repositoryRoot = path.resolve("."),
  testHooks?: {
    afterMove?: () => Promise<void>;
    beforeRollback?: () => Promise<void>;
  },
) {
  repositoryRoot = path.resolve(repositoryRoot);
  assertPlanIdentity(reviewedPlan);
  let rebuilt: JournalDeletePlan;
  try {
    rebuilt = await planJournalDelete({
      repositoryRoot,
      contentId: reviewedPlan.contentId,
      backupRoot: reviewedPlan.backupRoot,
    });
  } catch (error) {
    if (
      error instanceof JournalDeleteError &&
      (error.code === "incoming-reference" ||
        error.code === "parser-uncertainty")
    )
      throw error;
    throw new JournalDeleteError(
      "Canonical bytes, backup proof, or Git basis changed after review.",
      "plan-stale",
      { cause: error },
    );
  }
  const comparable = (plan: JournalDeletePlan) => ({
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
    throw new JournalDeleteError(
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
    throw new JournalDeleteError(
      "Another content lifecycle operation is active or requires reconciliation.",
      "lock-conflict",
      { cause: error },
    );
  }
  let record = recordFor(reviewedPlan, "prepared");
  const canonicalDirectory = path.join(
    repositoryRoot,
    "src/content/journal",
    reviewedPlan.contentId,
  );
  const recoveryDirectory = path.dirname(
    path.join(repositoryRoot, reviewedPlan.recoveryPaths[0]),
  );
  let moved = false;
  try {
    await assertContentLifecycleLock(repositoryRoot, lock.identity);
    const current = await journalInventory(
      repositoryRoot,
      reviewedPlan.contentId,
    );
    if (JSON.stringify(current) !== JSON.stringify(reviewedPlan.preimages))
      throw new JournalDeleteError(
        "Journal bytes drifted after lock acquisition.",
        "plan-stale",
      );
    await assertNoIncomingReferences(repositoryRoot, reviewedPlan.contentId);
    if (await fs.lstat(recoveryDirectory).catch(() => undefined))
      throw new JournalDeleteError(
        "Recovery destination already exists.",
        "state-mismatch",
      );
    await fs.mkdir(path.dirname(recoveryDirectory), {
      recursive: true,
      mode: 0o700,
    });
    await persistContentRecoveryRecord(repositoryRoot, record);
    await fs.rename(canonicalDirectory, recoveryDirectory);
    moved = true;
    await testHooks?.afterMove?.();
    if (await fs.lstat(canonicalDirectory).catch(() => undefined))
      throw new JournalDeleteError(
        "Canonical Journal unit remained after Delete.",
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
        if (await fs.lstat(canonicalDirectory).catch(() => undefined))
          throw new Error("canonical destination was recreated");
        await fs.rename(recoveryDirectory, canonicalDirectory);
        const restored = await journalInventory(
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
      throw new JournalDeleteError(
        "Journal Delete rollback failed; preserve the lock and inspect recovery evidence.",
        "rollback-failed",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    if (error instanceof JournalDeleteError) throw error;
    throw new JournalDeleteError(
      "Journal Delete failed and was rolled back.",
      "delete-failed",
      { cause: error },
    );
  }
}

export async function publishJournalDelete(
  operationId: string,
  repositoryRoot = path.resolve("."),
) {
  if (!/^[0-9a-f-]{36}$/i.test(operationId))
    throw new JournalDeleteError(
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
    throw new JournalDeleteError(
      "Completed Delete evidence is unavailable.",
      "state-mismatch",
      { cause: error },
    );
  }
  if (record.collection !== "journal")
    throw new JournalDeleteError(
      "Delete evidence does not belong to Journal.",
      "state-mismatch",
    );
  const files = plannedDeletePublishPaths(record);
  const git = async (args: string[]) =>
    execFile("git", args, { cwd: repositoryRoot, encoding: "utf8" }).then(
      ({ stdout }) => stdout.trim(),
    );
  if (await git(["diff", "--cached", "--name-only"]))
    throw new JournalDeleteError(
      "Publish requires a clean Git index.",
      "state-mismatch",
    );
  if (
    (await git(["rev-parse", "HEAD"])) !== record.repositoryHead ||
    !(await git(["symbolic-ref", "--quiet", "--short", "HEAD"]))
  )
    throw new JournalDeleteError(
      "Repository identity changed after the completed Delete.",
      "state-mismatch",
    );
  if (
    files.some(
      (file) => !file.startsWith(`src/content/journal/${record.contentId}/`),
    )
  )
    throw new JournalDeleteError(
      "Delete evidence escaped the Journal unit.",
      "state-mismatch",
    );
  try {
    await git(["add", "-A", "--", ...files]);
    const staged = (await git(["diff", "--cached", "--name-only"]))
      .split("\n")
      .filter(Boolean)
      .sort();
    if (JSON.stringify(staged) !== JSON.stringify([...files].sort()))
      throw new JournalDeleteError(
        "Staged paths do not exactly match completed Delete evidence.",
        "state-mismatch",
      );
    const status = await Promise.all(
      files.map((file) =>
        git(["diff", "--cached", "--name-status", "--", file]),
      ),
    );
    if (status.some((line) => !line.startsWith("D\t")))
      throw new JournalDeleteError(
        "Delete Publish requires three staged deletions.",
        "state-mismatch",
      );
    await git(["commit", "-m", `Delete journal: ${record.contentId}`]);
    return {
      state: "committed" as const,
      commit: await git(["rev-parse", "HEAD"]),
      files,
    };
  } catch (error) {
    await git(["reset", "--", ...files]).catch(() => undefined);
    if (error instanceof JournalDeleteError) throw error;
    throw new JournalDeleteError(
      "Failed to publish Journal Delete.",
      "publish-failed",
      { cause: error },
    );
  }
}
