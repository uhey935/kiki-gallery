import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { inspectWorksImage } from "./works-asset-inspection.ts";
import {
  assessWorksAssetFinalDeletion,
  assessWorksAssetQuarantineRetention,
  createWorksAssetDeletionManifest,
  createWorksAssetDeletionReview,
  serializeWorksAssetDeletionManifest,
  type WorksAssetDeletionConfirmation,
  type WorksAssetDeletionManifest,
  type WorksAssetDeletionReview,
  type WorksAssetQuarantineObservation,
  type WorksAssetQuarantineRetentionPolicy,
} from "./works-asset-physical-delete.ts";
import {
  hashWorksAssetQuarantineRecord,
  parseWorksAssetQuarantineRecord,
  type WorksAssetQuarantineRecord,
} from "./works-asset-reversible-cleanup.ts";
import {
  acquireWorksAssetRepositoryLock,
  releaseWorksAssetRepositoryLock,
} from "./works-asset-reversible-cleanup-store.ts";
import { loadWorksAssetCandidateLedger } from "./works-asset-candidate-ledger-store.ts";
import { createWorksAssetCleanupReport } from "./works-asset-cleanup.ts";
import { readWorksAssetInventory } from "./works-assets.ts";

const STATE = path.join(".kiki-editor", "asset-lifecycle");
const RECORDS = path.join(STATE, "quarantine", "records");
const MANIFESTS = path.join(STATE, "deletion-manifests");

export class WorksAssetPhysicalDeleteError extends Error {
  readonly code:
    | "unsafe-path"
    | "record-corrupt"
    | "ledger-drift"
    | "final-audit-failed"
    | "confirmation-required"
    | "hash-mismatch"
    | "unexpected-file-type"
    | "manual-recovery-required";

  constructor(
    code: WorksAssetPhysicalDeleteError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorksAssetPhysicalDeleteError";
    this.code = code;
  }
}

const resolvedInside = (root: string, relative: string) => {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`))
    throw new WorksAssetPhysicalDeleteError(
      "unsafe-path",
      "Path escaped repository",
    );
  return target;
};

const ensureRegularParents = async (root: string, relative: string) => {
  let current = path.resolve(root);
  const parts = relative.split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(() => undefined);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink())
      throw new WorksAssetPhysicalDeleteError(
        "unsafe-path",
        "Lifecycle path contains an unsafe directory",
      );
  }
};

const readRecord = async (repositoryRoot: string, recordId: string) => {
  if (!/^[a-f0-9]{64}$/.test(recordId))
    throw new WorksAssetPhysicalDeleteError(
      "record-corrupt",
      "Invalid quarantine record identity",
    );
  await ensureRegularParents(repositoryRoot, RECORDS);
  const recordPath = resolvedInside(
    repositoryRoot,
    path.join(RECORDS, `${recordId}.json`),
  );
  const stat = await fs.lstat(recordPath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new WorksAssetPhysicalDeleteError(
      "record-corrupt",
      "Quarantine record is missing or unsafe",
    );
  const record = parseWorksAssetQuarantineRecord(
    await fs.readFile(recordPath, "utf8"),
  );
  if (!record || record.recordId !== recordId || record.state !== "quarantined")
    throw new WorksAssetPhysicalDeleteError(
      "record-corrupt",
      "Quarantine record is corrupt or not active",
    );
  return { record, recordSha256: hashWorksAssetQuarantineRecord(record) };
};

const sourcePathState = async (
  repositoryRoot: string,
  record: WorksAssetQuarantineRecord,
) => {
  await ensureRegularParents(
    repositoryRoot,
    path.dirname(record.originalRelativePath),
  );
  const source = resolvedInside(repositoryRoot, record.originalRelativePath);
  const stat = await fs.lstat(source).catch(() => undefined);
  if (!stat) return { exists: false, identityMatches: false };
  if (!stat.isFile() || stat.isSymbolicLink())
    return { exists: true, identityMatches: false };
  const hash = createHash("sha256")
    .update(await fs.readFile(source))
    .digest("hex");
  return {
    exists: true,
    identityMatches:
      hash === record.assetSha256 && stat.size === record.byteSize,
  };
};

const loadFinalEvidence = async (input: {
  repositoryRoot: string;
  recordId: string;
  expectedLedgerSha256: string;
  expectedRecordSha256: string;
  expectedSnapshotSha256?: string;
  observations: readonly WorksAssetQuarantineObservation[];
  retentionPolicy: WorksAssetQuarantineRetentionPolicy;
  now: string;
  confirmation?: WorksAssetDeletionConfirmation;
}) => {
  const loaded = await loadWorksAssetCandidateLedger(input.repositoryRoot);
  if (loaded.status !== "loaded")
    throw new WorksAssetPhysicalDeleteError(
      "ledger-drift",
      "Candidate ledger is missing or corrupt",
    );
  const { record, recordSha256 } = await readRecord(
    input.repositoryRoot,
    input.recordId,
  );
  const report = createWorksAssetCleanupReport(
    await readWorksAssetInventory(
      resolvedInside(input.repositoryRoot, "public/images/works"),
      resolvedInside(input.repositoryRoot, "src/content/works"),
    ),
  );
  const source = await sourcePathState(input.repositoryRoot, record);
  const retention = assessWorksAssetQuarantineRetention(
    record,
    recordSha256,
    input.observations,
    input.retentionPolicy,
    input.now,
  );
  const assessment = assessWorksAssetFinalDeletion({
    ledger: loaded.ledger,
    ledgerSha256: loaded.ledgerSha256,
    expectedLedgerSha256: input.expectedLedgerSha256,
    record,
    recordSha256,
    expectedRecordSha256: input.expectedRecordSha256,
    report,
    expectedSnapshotSha256: input.expectedSnapshotSha256,
    sourceCanonicalPathExists: source.exists,
    sourceCanonicalIdentityMatchesQuarantined: source.identityMatches,
    retentionSatisfied: retention.ok,
    confirmation: input.confirmation,
  });
  if (!assessment.ok)
    throw new WorksAssetPhysicalDeleteError(
      assessment.code === "stale-confirmation"
        ? "confirmation-required"
        : "final-audit-failed",
      `Final locked re-audit failed: ${assessment.code}`,
    );
  return { loaded, record, recordSha256, report, retention };
};

/** Builds displayable confirmation information from a locked final re-audit. */
export async function prepareWorksAssetDeletionReview(input: {
  repositoryRoot: string;
  recordId: string;
  expectedLedgerSha256: string;
  expectedRecordSha256: string;
  observations: readonly WorksAssetQuarantineObservation[];
  retentionPolicy: WorksAssetQuarantineRetentionPolicy;
  now: string;
}): Promise<WorksAssetDeletionReview> {
  const lock = await acquireWorksAssetRepositoryLock(
    input.repositoryRoot,
    input.now,
  );
  try {
    const evidence = await loadFinalEvidence(input);
    return createWorksAssetDeletionReview({
      record: evidence.record,
      recordSha256: evidence.recordSha256,
      ledgerSha256: evidence.loaded.ledgerSha256,
      finalSnapshotSha256: evidence.report.snapshotSha256,
      reviewedAt: input.now,
      retentionEvidence: evidence.retention.observations,
    });
  } finally {
    await releaseWorksAssetRepositoryLock(input.repositoryRoot, lock.identity);
  }
}

const manifestPath = (repositoryRoot: string, identity: string) =>
  resolvedInside(repositoryRoot, path.join(MANIFESTS, `${identity}.json`));

const writeManifest = async (
  repositoryRoot: string,
  manifest: WorksAssetDeletionManifest,
) => {
  await ensureRegularParents(repositoryRoot, STATE);
  await fs
    .mkdir(resolvedInside(repositoryRoot, MANIFESTS), { recursive: false })
    .catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  await ensureRegularParents(repositoryRoot, MANIFESTS);
  const target = manifestPath(repositoryRoot, manifest.manifestIdentity);
  const staged = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(staged, serializeWorksAssetDeletionManifest(manifest), {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(staged, target);
  } finally {
    await fs.rm(staged, { force: true }).catch(() => undefined);
  }
};

const matchingCompletedManifest = async (
  repositoryRoot: string,
  recordId: string,
  review: WorksAssetDeletionReview,
  confirmation: WorksAssetDeletionConfirmation,
) => {
  await ensureRegularParents(repositoryRoot, MANIFESTS).catch(() => undefined);
  const names = await fs
    .readdir(resolvedInside(repositoryRoot, MANIFESTS))
    .catch(() => []);
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const value = await fs
      .readFile(
        resolvedInside(repositoryRoot, path.join(MANIFESTS, name)),
        "utf8",
      )
      .then((text) => JSON.parse(text) as WorksAssetDeletionManifest)
      .catch(() => null);
    if (
      value?.schemaVersion === 1 &&
      value.confirmationIdentity === confirmation.confirmationIdentity &&
      value.quarantineRecordId === recordId &&
      value.targetIdentity === review.candidateIdentity &&
      value.quarantineRecordSha256 === review.quarantineRecordSha256 &&
      value.ledgerSha256 === review.ledgerSha256 &&
      value.finalSnapshotSha256 === review.finalSnapshotSha256 &&
      value.manifestIdentity ===
        createHash("sha256")
          .update(
            JSON.stringify({
              targetIdentity: value.targetIdentity,
              confirmationIdentity: value.confirmationIdentity,
              lockIdentity: value.lockIdentity,
              preparedAt: value.preparedAt,
            }),
          )
          .digest("hex") &&
      value.state === "physically-deleted" &&
      value.resultState === "physically-deleted" &&
      typeof value.deletedAt === "string" &&
      value.failure === null
    )
      return value;
  }
  return null;
};

/** The only physical-delete capability. It unlinks one verified quarantine file. */
export async function physicallyDeleteWorksAsset(input: {
  repositoryRoot: string;
  recordId: string;
  review: WorksAssetDeletionReview;
  confirmation: WorksAssetDeletionConfirmation | null;
  observations: readonly WorksAssetQuarantineObservation[];
  retentionPolicy: WorksAssetQuarantineRetentionPolicy;
  now: string;
  failAfterDelete?: boolean;
}): Promise<WorksAssetDeletionManifest> {
  if (!input.confirmation)
    throw new WorksAssetPhysicalDeleteError(
      "confirmation-required",
      "Explicit per-asset confirmation is required",
    );
  const lock = await acquireWorksAssetRepositoryLock(
    input.repositoryRoot,
    input.now,
  );
  let prepared: WorksAssetDeletionManifest | null = null;
  let deleted = false;
  let finalized = false;
  try {
    const priorCompleted = await matchingCompletedManifest(
      input.repositoryRoot,
      input.recordId,
      input.review,
      input.confirmation,
    );
    if (priorCompleted) return priorCompleted;
    if (
      input.confirmation.reviewIdentity !== input.review.reviewIdentity ||
      input.confirmation.confirmationIdentity.length !== 64
    )
      throw new WorksAssetPhysicalDeleteError(
        "confirmation-required",
        "Confirmation is not bound to this reviewed asset",
      );
    const evidence = await loadFinalEvidence({
      repositoryRoot: input.repositoryRoot,
      recordId: input.recordId,
      expectedLedgerSha256: input.review.ledgerSha256,
      expectedRecordSha256: input.review.quarantineRecordSha256,
      expectedSnapshotSha256: input.review.finalSnapshotSha256,
      observations: input.observations,
      retentionPolicy: input.retentionPolicy,
      now: input.now,
      confirmation: input.confirmation,
    });
    const target = resolvedInside(
      input.repositoryRoot,
      evidence.record.quarantineRelativePath,
    );
    await ensureRegularParents(
      input.repositoryRoot,
      path.dirname(evidence.record.quarantineRelativePath),
    );
    const stat = await fs.lstat(target).catch(() => undefined);
    if (!stat?.isFile() || stat.isSymbolicLink())
      throw new WorksAssetPhysicalDeleteError(
        "unsafe-path",
        "Quarantined asset is missing, non-regular, or a symlink",
      );
    const bytes = await fs.readFile(target);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (
      actualHash !== evidence.record.assetSha256 ||
      stat.size !== evidence.record.byteSize
    )
      throw new WorksAssetPhysicalDeleteError(
        "hash-mismatch",
        "Quarantined asset identity changed",
      );
    let inspected;
    try {
      inspected = inspectWorksImage(bytes);
    } catch (error) {
      throw new WorksAssetPhysicalDeleteError(
        "unexpected-file-type",
        "Quarantined asset is not a supported image",
        { cause: error },
      );
    }
    if (inspected.format !== evidence.record.format)
      throw new WorksAssetPhysicalDeleteError(
        "unexpected-file-type",
        "Quarantined asset format changed",
      );
    prepared = createWorksAssetDeletionManifest({
      review: input.review,
      confirmation: input.confirmation,
      record: evidence.record,
      lockIdentity: lock.identity,
      preparedAt: input.now,
    });
    await writeManifest(input.repositoryRoot, prepared);
    await fs.unlink(target);
    deleted = true;
    if (input.failAfterDelete) throw new Error("injected-post-delete-failure");
    const completed: WorksAssetDeletionManifest = {
      ...prepared,
      state: "physically-deleted",
      resultState: "physically-deleted",
      deletedAt: new Date(Date.parse(input.now)).toISOString(),
    };
    await writeManifest(input.repositoryRoot, completed);
    finalized = true;
    return completed;
  } catch (error) {
    if (!deleted) throw error;
    const recovery: WorksAssetDeletionManifest = {
      ...prepared!,
      state: "manual-recovery-required",
      resultState: "manual-recovery-required",
      deletedAt: new Date(Date.parse(input.now)).toISOString(),
      failure: error instanceof Error ? error.message : "unknown-failure",
    };
    await writeManifest(input.repositoryRoot, recovery).catch(() => undefined);
    throw new WorksAssetPhysicalDeleteError(
      "manual-recovery-required",
      "Asset bytes were deleted but finalization failed; preserve lock and evidence",
      { cause: error },
    );
  } finally {
    if (!deleted || finalized) {
      await releaseWorksAssetRepositoryLock(
        input.repositoryRoot,
        lock.identity,
      );
    }
  }
}
