import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  assessWorksAssetQuarantine,
  createWorksAssetQuarantineRecord,
  parseWorksAssetQuarantineRecord,
  serializeWorksAssetQuarantineRecord,
  type WorksAssetQuarantineRecord,
} from "./works-asset-reversible-cleanup.ts";
import { loadWorksAssetCandidateLedger } from "./works-asset-candidate-ledger-store.ts";
import { createWorksAssetCleanupReport } from "./works-asset-cleanup.ts";
import { readWorksAssetInventory } from "./works-assets.ts";
import {
  acquireWorksAssetRepositoryLock as acquireSharedLock,
  assertWorksAssetRepositoryLock,
  releaseWorksAssetRepositoryLock as releaseSharedLock,
  type RepositoryLock,
} from "./works-asset-repository-lock.ts";

export type { RepositoryLock } from "./works-asset-repository-lock.ts";

const STATE = path.join(".kiki-editor", "asset-lifecycle");
const RECORDS = path.join(STATE, "quarantine", "records");

export class WorksAssetReversibleCleanupError extends Error {
  readonly code:
    | "lock-conflict"
    | "stale-lock"
    | "lock-ownership"
    | "unsafe-path"
    | "asset-conflict"
    | "hash-mismatch"
    | "record-corrupt"
    | "transaction-failed";

  constructor(
    code:
      | "lock-conflict"
      | "stale-lock"
      | "lock-ownership"
      | "unsafe-path"
      | "asset-conflict"
      | "hash-mismatch"
      | "record-corrupt"
      | "transaction-failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorksAssetReversibleCleanupError";
    this.code = code;
  }
}

const resolvedInside = (root: string, relative: string) => {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`))
    throw new WorksAssetReversibleCleanupError(
      "unsafe-path",
      "Path escaped repository",
    );
  return target;
};
const hashFile = async (file: string) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const ensureRegularParents = async (
  root: string,
  relative: string,
  create = false,
) => {
  let current = path.resolve(root);
  const rootStat = await fs.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new WorksAssetReversibleCleanupError(
      "unsafe-path",
      "Unsafe repository root",
    );
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat = await fs.lstat(current).catch(() => undefined);
    if (!stat && create) {
      await fs.mkdir(current);
      stat = await fs.lstat(current);
    }
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink())
      throw new WorksAssetReversibleCleanupError(
        "unsafe-path",
        "Unsafe lifecycle directory",
      );
  }
};

async function assertLockOwnership(repositoryRoot: string, identity: string) {
  try {
    await assertWorksAssetRepositoryLock(repositoryRoot, identity);
  } catch (error) {
    throw new WorksAssetReversibleCleanupError(
      "lock-ownership",
      "Repository lock is not owned by this operation",
      { cause: error },
    );
  }
}

export async function acquireWorksAssetRepositoryLock(
  repositoryRoot: string,
  now: string,
  ttlMs = 300_000,
): Promise<RepositoryLock> {
  try {
    return await acquireSharedLock(repositoryRoot, now, ttlMs);
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new WorksAssetReversibleCleanupError(
      code === "stale-lock"
        ? "stale-lock"
        : code === "unsafe-path"
          ? "unsafe-path"
          : "lock-conflict",
      error instanceof Error ? error.message : "Repository lock failed",
      { cause: error },
    );
  }
}

export async function releaseWorksAssetRepositoryLock(
  repositoryRoot: string,
  identity: string,
) {
  try {
    await releaseSharedLock(repositoryRoot, identity);
  } catch (error) {
    throw new WorksAssetReversibleCleanupError(
      "lock-ownership",
      "Lock ownership changed",
      { cause: error },
    );
  }
}

const validateAssetPath = async (
  repositoryRoot: string,
  relative: string,
  mustExist: boolean,
) => {
  const target = resolvedInside(repositoryRoot, relative);
  await ensureRegularParents(repositoryRoot, path.dirname(relative), false);
  const stat = await fs.lstat(target).catch(() => undefined);
  if (mustExist && (!stat || !stat.isFile() || stat.isSymbolicLink()))
    throw new WorksAssetReversibleCleanupError(
      "unsafe-path",
      "Asset is missing or unsafe",
    );
  if (!mustExist && stat)
    throw new WorksAssetReversibleCleanupError(
      "asset-conflict",
      "Destination already exists",
    );
  return target;
};

export async function quarantineWorksAsset(input: {
  repositoryRoot: string;
  lock: RepositoryLock;
  publicUrl: string;
  filename: string;
  assetSha256: string;
  byteSize: number;
  format: WorksAssetQuarantineRecord["format"];
  quarantinedAt: string;
  sourceSnapshotSha256: string;
  sourceLedgerSha256: string;
  failAfterMove?: boolean;
}): Promise<WorksAssetQuarantineRecord> {
  await assertLockOwnership(input.repositoryRoot, input.lock.identity);
  const record = createWorksAssetQuarantineRecord({
    ...input,
    lockIdentity: input.lock.identity,
  });
  const source = await validateAssetPath(
    input.repositoryRoot,
    record.originalRelativePath,
    true,
  );
  if ((await hashFile(source)) !== record.assetSha256)
    throw new WorksAssetReversibleCleanupError(
      "hash-mismatch",
      "Canonical asset identity changed",
    );
  const actual = await fs.lstat(source);
  if (actual.size !== record.byteSize)
    throw new WorksAssetReversibleCleanupError(
      "hash-mismatch",
      "Canonical asset size changed",
    );
  await ensureRegularParents(
    input.repositoryRoot,
    path.dirname(record.quarantineRelativePath),
    true,
  );
  await ensureRegularParents(input.repositoryRoot, RECORDS, true);
  const destination = await validateAssetPath(
    input.repositoryRoot,
    record.quarantineRelativePath,
    false,
  );
  const recordPath = resolvedInside(
    input.repositoryRoot,
    path.join(RECORDS, `${record.recordId}.json`),
  );
  const stagedRecord = `${recordPath}.${randomUUID()}.tmp`;
  try {
    await fs.rename(source, destination);
    if (input.failAfterMove) throw new Error("injected-failure");
    await fs.writeFile(
      stagedRecord,
      serializeWorksAssetQuarantineRecord(record),
      { flag: "wx", mode: 0o600 },
    );
    await fs.rename(stagedRecord, recordPath);
    return record;
  } catch (error) {
    await fs.rename(destination, source).catch(() => undefined);
    await fs.rmdir(path.dirname(destination)).catch(() => undefined);
    throw new WorksAssetReversibleCleanupError(
      "transaction-failed",
      "Quarantine rolled back or requires manual recovery",
      { cause: error },
    );
  } finally {
    await fs.rm(stagedRecord, { force: true }).catch(() => undefined);
  }
}

export async function restoreWorksAsset(input: {
  repositoryRoot: string;
  lock: RepositoryLock;
  recordId: string;
  restoredAt: string;
}): Promise<WorksAssetQuarantineRecord> {
  await assertLockOwnership(input.repositoryRoot, input.lock.identity);
  if (!/^[a-f0-9]{64}$/.test(input.recordId))
    throw new WorksAssetReversibleCleanupError(
      "record-corrupt",
      "Invalid record identity",
    );
  const recordPath = resolvedInside(
    input.repositoryRoot,
    path.join(RECORDS, `${input.recordId}.json`),
  );
  const record = parseWorksAssetQuarantineRecord(
    await fs.readFile(recordPath, "utf8").catch(() => ""),
  );
  if (
    !record ||
    record.recordId !== input.recordId ||
    record.state !== "quarantined"
  )
    throw new WorksAssetReversibleCleanupError(
      "record-corrupt",
      "Quarantine record is invalid",
    );
  const source = await validateAssetPath(
    input.repositoryRoot,
    record.quarantineRelativePath,
    true,
  );
  const destination = await validateAssetPath(
    input.repositoryRoot,
    record.originalRelativePath,
    false,
  );
  if (
    (await hashFile(source)) !== record.assetSha256 ||
    (await fs.lstat(source)).size !== record.byteSize
  )
    throw new WorksAssetReversibleCleanupError(
      "hash-mismatch",
      "Quarantined asset identity changed",
    );
  const restored: WorksAssetQuarantineRecord = {
    ...record,
    state: "restored",
    restoredAt: new Date(Date.parse(input.restoredAt)).toISOString(),
    restoreLockIdentity: input.lock.identity,
    eligibleForDeletion: false,
  };
  const stagedRecord = `${recordPath}.${randomUUID()}.tmp`;
  try {
    await fs.rename(source, destination);
    await fs.writeFile(
      stagedRecord,
      serializeWorksAssetQuarantineRecord(restored),
      { flag: "wx", mode: 0o600 },
    );
    await fs.rename(stagedRecord, recordPath);
    return restored;
  } catch (error) {
    await fs.rename(destination, source).catch(() => undefined);
    throw new WorksAssetReversibleCleanupError(
      "transaction-failed",
      "Restore rolled back or requires manual recovery",
      { cause: error },
    );
  } finally {
    await fs.rm(stagedRecord, { force: true }).catch(() => undefined);
  }
}

/** Locked end-to-end action: reload ledger, rebuild the graph, recheck retention, then move. */
export async function runWorksAssetQuarantine(input: {
  repositoryRoot: string;
  publicUrl: string;
  expectedLedgerSha256: string;
  expectedSnapshotSha256: string;
  now: string;
}) {
  const lock = await acquireWorksAssetRepositoryLock(
    input.repositoryRoot,
    input.now,
  );
  try {
    const loaded = await loadWorksAssetCandidateLedger(input.repositoryRoot);
    if (
      loaded.status !== "loaded" ||
      loaded.ledgerSha256 !== input.expectedLedgerSha256
    )
      throw new WorksAssetReversibleCleanupError(
        "hash-mismatch",
        "Ledger changed before fresh re-audit",
      );
    const assetRoot = resolvedInside(
      input.repositoryRoot,
      "public/images/works",
    );
    const worksRoot = resolvedInside(input.repositoryRoot, "src/content/works");
    const report = createWorksAssetCleanupReport(
      await readWorksAssetInventory(assetRoot, worksRoot),
    );
    const assessment = assessWorksAssetQuarantine(
      loaded.ledger,
      loaded.ledgerSha256,
      report,
      input.publicUrl,
      input.expectedSnapshotSha256,
    );
    if (!assessment.ok)
      throw new WorksAssetReversibleCleanupError(
        "hash-mismatch",
        `Fresh re-audit failed: ${assessment.code}`,
      );
    return await quarantineWorksAsset({
      repositoryRoot: input.repositoryRoot,
      lock,
      publicUrl: assessment.entry.publicUrl,
      filename: assessment.entry.filename,
      assetSha256: assessment.entry.assetSha256,
      byteSize: assessment.entry.byteSize,
      format: assessment.entry.format,
      quarantinedAt: input.now,
      sourceSnapshotSha256: report.snapshotSha256,
      sourceLedgerSha256: loaded.ledgerSha256,
    });
  } finally {
    await releaseWorksAssetRepositoryLock(input.repositoryRoot, lock.identity);
  }
}

export async function inspectWorksAssetCleanupRecovery(repositoryRoot: string) {
  const quarantineRoot = resolvedInside(
    repositoryRoot,
    path.join(STATE, "quarantine"),
  );
  const names = await fs
    .readdir(quarantineRoot, { recursive: true })
    .catch(() => []);
  const findings = names.filter((name) => name.endsWith(".tmp")).map(String);
  const assetRoot = path.join(quarantineRoot, "assets");
  const recordRoot = path.join(quarantineRoot, "records");
  const assetIds = await fs.readdir(assetRoot).catch(() => []);
  for (const recordId of assetIds) {
    const stat = await fs
      .lstat(path.join(assetRoot, recordId))
      .catch(() => null);
    const record = await fs
      .lstat(path.join(recordRoot, `${recordId}.json`))
      .catch(() => null);
    if (stat?.isDirectory() && !stat.isSymbolicLink() && !record)
      findings.push(`unrecorded-asset:${recordId}`);
  }
  return findings.sort();
}
