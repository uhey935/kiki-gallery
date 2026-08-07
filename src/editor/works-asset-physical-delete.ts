import { createHash } from "node:crypto";

import type { WorksAssetCandidateLedger } from "./works-asset-candidate-ledger.ts";
import type { WorksAssetCleanupReport } from "./works-asset-cleanup.ts";
import type { WorksAssetQuarantineRecord } from "./works-asset-reversible-cleanup.ts";

export const WORKS_ASSET_DELETION_SCHEMA_VERSION = 1 as const;

export type WorksAssetQuarantineRetentionPolicy = {
  minimumAgeMs: number;
  minimumObservations: number;
};

export type WorksAssetQuarantineObservation = {
  observedAt: string;
  quarantineRecordSha256: string;
  assetSha256: string;
};

export type WorksAssetDeletionReview = {
  schemaVersion: 1;
  reviewIdentity: string;
  candidateIdentity: string;
  publicUrl: string;
  sourceCanonicalPath: string;
  quarantineRecordId: string;
  quarantineRecordSha256: string;
  assetSha256: string;
  byteSize: number;
  format: WorksAssetQuarantineRecord["format"];
  quarantinedAt: string;
  reviewedAt: string;
  quarantineAgeMs: number;
  ledgerSha256: string;
  finalSnapshotSha256: string;
  retentionEvidence: WorksAssetQuarantineObservation[];
};

export type WorksAssetDeletionConfirmation = {
  schemaVersion: 1;
  confirmationIdentity: string;
  reviewIdentity: string;
  candidateIdentity: string;
  quarantineRecordSha256: string;
  ledgerSha256: string;
  finalSnapshotSha256: string;
  explicitlyConfirmedAt: string;
};

export type WorksAssetDeletionManifestState =
  | "prepared"
  | "physically-deleted"
  | "manual-recovery-required";

export type WorksAssetDeletionManifest = {
  schemaVersion: 1;
  manifestIdentity: string;
  state: WorksAssetDeletionManifestState;
  targetIdentity: string;
  publicUrl: string;
  sourceCanonicalPath: string;
  quarantineRelativePath: string;
  quarantineRecordId: string;
  quarantineRecordSha256: string;
  ledgerSha256: string;
  finalSnapshotSha256: string;
  confirmationIdentity: string;
  lockIdentity: string;
  retentionEvidence: WorksAssetQuarantineObservation[];
  preparedAt: string;
  deletedAt: string | null;
  deletedAssetSha256: string;
  deletedByteSize: number;
  deletedFormat: WorksAssetQuarantineRecord["format"];
  resultState: WorksAssetDeletionManifestState;
  failure: string | null;
};

export type FinalDeletionAssessment =
  | { ok: true; candidateIdentity: string }
  | {
      ok: false;
      code:
        | "ledger-not-retained"
        | "record-not-quarantined"
        | "record-drift"
        | "ledger-drift"
        | "graph-incomplete"
        | "audit-error"
        | "re-referenced"
        | "identity-drift"
        | "snapshot-drift"
        | "retention-not-satisfied"
        | "stale-confirmation";
    };

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const canonicalTime = (value: string) => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("invalid-time");
  return new Date(milliseconds).toISOString();
};
const candidateIdentity = (record: WorksAssetQuarantineRecord) =>
  sha256(
    JSON.stringify({
      publicUrl: record.publicUrl,
      assetSha256: record.assetSha256,
      byteSize: record.byteSize,
      format: record.format,
    }),
  );
const canonicalObservations = (
  observations: readonly WorksAssetQuarantineObservation[],
) =>
  observations
    .map((item) => ({ ...item, observedAt: canonicalTime(item.observedAt) }))
    .sort(
      (a, b) =>
        a.observedAt.localeCompare(b.observedAt, "en") ||
        a.quarantineRecordSha256.localeCompare(b.quarantineRecordSha256, "en"),
    );

export function assessWorksAssetQuarantineRetention(
  record: WorksAssetQuarantineRecord,
  recordSha256: string,
  observationsInput: readonly WorksAssetQuarantineObservation[],
  policy: WorksAssetQuarantineRetentionPolicy,
  nowInput: string,
) {
  const now = canonicalTime(nowInput);
  if (
    !Number.isSafeInteger(policy.minimumAgeMs) ||
    policy.minimumAgeMs <= 0 ||
    !Number.isSafeInteger(policy.minimumObservations) ||
    policy.minimumObservations < 2
  )
    throw new Error("invalid-quarantine-retention-policy");
  const observations = canonicalObservations(observationsInput);
  const matching = observations.filter(
    (item) =>
      item.quarantineRecordSha256 === recordSha256 &&
      item.assetSha256 === record.assetSha256 &&
      Date.parse(item.observedAt) >= Date.parse(record.quarantinedAt) &&
      Date.parse(item.observedAt) <= Date.parse(now),
  );
  const uniqueTimes = new Set(matching.map((item) => item.observedAt));
  const quarantineAgeMs = Date.parse(now) - Date.parse(record.quarantinedAt);
  return {
    ok:
      quarantineAgeMs >= policy.minimumAgeMs &&
      uniqueTimes.size >= policy.minimumObservations,
    quarantineAgeMs,
    observations: matching,
  };
}

export function assessWorksAssetFinalDeletion(input: {
  ledger: WorksAssetCandidateLedger;
  ledgerSha256: string;
  expectedLedgerSha256: string;
  record: WorksAssetQuarantineRecord;
  recordSha256: string;
  expectedRecordSha256: string;
  report: WorksAssetCleanupReport;
  expectedSnapshotSha256?: string;
  sourceCanonicalPathExists: boolean;
  sourceCanonicalIdentityMatchesQuarantined?: boolean;
  retentionSatisfied: boolean;
  confirmation?: WorksAssetDeletionConfirmation;
}): FinalDeletionAssessment {
  const entry = input.ledger.entries.find(
    (item) =>
      item.publicUrl === input.record.publicUrl &&
      item.state === "retention-satisfied",
  );
  if (!entry) return { ok: false, code: "ledger-not-retained" };
  if (input.record.state !== "quarantined")
    return { ok: false, code: "record-not-quarantined" };
  if (
    !isSha256(input.recordSha256) ||
    input.recordSha256 !== input.expectedRecordSha256
  )
    return { ok: false, code: "record-drift" };
  if (
    !isSha256(input.ledgerSha256) ||
    input.ledgerSha256 !== input.expectedLedgerSha256
  )
    return { ok: false, code: "ledger-drift" };
  if (!input.report.referenceGraphComplete)
    return { ok: false, code: "graph-incomplete" };
  if (input.report.audit.length) return { ok: false, code: "audit-error" };
  if (
    input.report.candidates.some(
      (candidate) => candidate.publicUrl === input.record.publicUrl,
    )
  )
    return { ok: false, code: "re-referenced" };
  if (input.sourceCanonicalPathExists)
    return {
      ok: false,
      code: input.sourceCanonicalIdentityMatchesQuarantined
        ? "re-referenced"
        : "identity-drift",
    };
  if (
    entry.assetSha256 !== input.record.assetSha256 ||
    entry.byteSize !== input.record.byteSize ||
    entry.format !== input.record.format
  )
    return { ok: false, code: "identity-drift" };
  if (
    input.expectedSnapshotSha256 !== undefined &&
    input.report.snapshotSha256 !== input.expectedSnapshotSha256
  )
    return { ok: false, code: "snapshot-drift" };
  if (!input.retentionSatisfied)
    return { ok: false, code: "retention-not-satisfied" };
  const identity = candidateIdentity(input.record);
  if (input.confirmation) {
    const confirmation = input.confirmation;
    const expectedConfirmationIdentity = sha256(
      JSON.stringify({
        reviewIdentity: confirmation.reviewIdentity,
        candidateIdentity: confirmation.candidateIdentity,
        quarantineRecordSha256: confirmation.quarantineRecordSha256,
        ledgerSha256: confirmation.ledgerSha256,
        finalSnapshotSha256: confirmation.finalSnapshotSha256,
        explicitlyConfirmedAt: canonicalTime(
          confirmation.explicitlyConfirmedAt,
        ),
      }),
    );
    if (
      confirmation.schemaVersion !== 1 ||
      confirmation.confirmationIdentity !== expectedConfirmationIdentity ||
      confirmation.candidateIdentity !== identity ||
      confirmation.quarantineRecordSha256 !== input.recordSha256 ||
      confirmation.ledgerSha256 !== input.ledgerSha256 ||
      confirmation.finalSnapshotSha256 !== input.report.snapshotSha256
    )
      return { ok: false, code: "stale-confirmation" };
  }
  return { ok: true, candidateIdentity: identity };
}

export function createWorksAssetDeletionReview(input: {
  record: WorksAssetQuarantineRecord;
  recordSha256: string;
  ledgerSha256: string;
  finalSnapshotSha256: string;
  reviewedAt: string;
  retentionEvidence: readonly WorksAssetQuarantineObservation[];
}): WorksAssetDeletionReview {
  const reviewedAt = canonicalTime(input.reviewedAt);
  const evidence = canonicalObservations(input.retentionEvidence);
  const core = {
    candidateIdentity: candidateIdentity(input.record),
    publicUrl: input.record.publicUrl,
    sourceCanonicalPath: input.record.originalRelativePath,
    quarantineRecordId: input.record.recordId,
    quarantineRecordSha256: input.recordSha256,
    assetSha256: input.record.assetSha256,
    byteSize: input.record.byteSize,
    format: input.record.format,
    quarantinedAt: input.record.quarantinedAt,
    reviewedAt,
    quarantineAgeMs:
      Date.parse(reviewedAt) - Date.parse(input.record.quarantinedAt),
    ledgerSha256: input.ledgerSha256,
    finalSnapshotSha256: input.finalSnapshotSha256,
    retentionEvidence: evidence,
  };
  return {
    schemaVersion: WORKS_ASSET_DELETION_SCHEMA_VERSION,
    reviewIdentity: sha256(JSON.stringify(core)),
    ...core,
  };
}

export function explicitlyConfirmWorksAssetDeletion(
  review: WorksAssetDeletionReview,
  explicitlyConfirmedAtInput: string,
): WorksAssetDeletionConfirmation {
  const explicitlyConfirmedAt = canonicalTime(explicitlyConfirmedAtInput);
  if (Date.parse(explicitlyConfirmedAt) < Date.parse(review.reviewedAt))
    throw new Error("confirmation-before-review");
  const core = {
    reviewIdentity: review.reviewIdentity,
    candidateIdentity: review.candidateIdentity,
    quarantineRecordSha256: review.quarantineRecordSha256,
    ledgerSha256: review.ledgerSha256,
    finalSnapshotSha256: review.finalSnapshotSha256,
    explicitlyConfirmedAt,
  };
  return {
    schemaVersion: WORKS_ASSET_DELETION_SCHEMA_VERSION,
    confirmationIdentity: sha256(JSON.stringify(core)),
    ...core,
  };
}

export function createWorksAssetDeletionManifest(input: {
  review: WorksAssetDeletionReview;
  confirmation: WorksAssetDeletionConfirmation;
  record: WorksAssetQuarantineRecord;
  lockIdentity: string;
  preparedAt: string;
}): WorksAssetDeletionManifest {
  const preparedAt = canonicalTime(input.preparedAt);
  const manifestIdentity = sha256(
    JSON.stringify({
      targetIdentity: input.review.candidateIdentity,
      confirmationIdentity: input.confirmation.confirmationIdentity,
      lockIdentity: input.lockIdentity,
      preparedAt,
    }),
  );
  return {
    schemaVersion: WORKS_ASSET_DELETION_SCHEMA_VERSION,
    manifestIdentity,
    state: "prepared",
    targetIdentity: input.review.candidateIdentity,
    publicUrl: input.record.publicUrl,
    sourceCanonicalPath: input.record.originalRelativePath,
    quarantineRelativePath: input.record.quarantineRelativePath,
    quarantineRecordId: input.record.recordId,
    quarantineRecordSha256: input.review.quarantineRecordSha256,
    ledgerSha256: input.review.ledgerSha256,
    finalSnapshotSha256: input.review.finalSnapshotSha256,
    confirmationIdentity: input.confirmation.confirmationIdentity,
    lockIdentity: input.lockIdentity,
    retentionEvidence: input.review.retentionEvidence.map((item) => ({
      ...item,
    })),
    preparedAt,
    deletedAt: null,
    deletedAssetSha256: input.record.assetSha256,
    deletedByteSize: input.record.byteSize,
    deletedFormat: input.record.format,
    resultState: "prepared",
    failure: null,
  };
}

export const serializeWorksAssetDeletionManifest = (
  manifest: WorksAssetDeletionManifest,
) => `${JSON.stringify(manifest, null, 2)}\n`;
export const hashWorksAssetDeletionManifest = (
  manifest: WorksAssetDeletionManifest,
) => sha256(serializeWorksAssetDeletionManifest(manifest));
