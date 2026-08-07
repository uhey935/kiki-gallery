import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorksAssetCandidateLedger,
  observeWorksAssetCleanupReport,
} from "./works-asset-candidate-ledger.ts";
import type { WorksAssetCleanupReport } from "./works-asset-cleanup.ts";
import {
  assessWorksAssetFinalDeletion,
  assessWorksAssetQuarantineRetention,
  createWorksAssetDeletionManifest,
  createWorksAssetDeletionReview,
  explicitlyConfirmWorksAssetDeletion,
  hashWorksAssetDeletionManifest,
  serializeWorksAssetDeletionManifest,
  type WorksAssetQuarantineObservation,
} from "./works-asset-physical-delete.ts";
import {
  createWorksAssetQuarantineRecord,
  hashWorksAssetQuarantineRecord,
} from "./works-asset-reversible-cleanup.ts";

const record = createWorksAssetQuarantineRecord({
  publicUrl: "/images/works/orphan.png",
  filename: "orphan.png",
  assetSha256: "a".repeat(64),
  byteSize: 3,
  format: "png",
  quarantinedAt: "2026-08-01T00:00:00Z",
  sourceSnapshotSha256: "b".repeat(64),
  sourceLedgerSha256: "c".repeat(64),
  lockIdentity: "quarantine-lock",
});
const recordHash = hashWorksAssetQuarantineRecord(record);
const observations: WorksAssetQuarantineObservation[] = [
  {
    observedAt: "2026-08-02T00:00:00Z",
    quarantineRecordSha256: recordHash,
    assetSha256: record.assetSha256,
  },
  {
    observedAt: "2026-08-03T00:00:00Z",
    quarantineRecordSha256: recordHash,
    assetSha256: record.assetSha256,
  },
];
const cleanupReport = (snapshot = "d".repeat(64)): WorksAssetCleanupReport => ({
  schemaVersion: 1,
  mode: "read-only",
  referenceGraphComplete: true,
  eligibleForDeletion: false,
  snapshotSha256: snapshot,
  candidates: [],
  audit: [],
});
const retainedLedger = () => {
  const candidate = {
    publicUrl: record.publicUrl,
    filename: "orphan.png",
    sha256: record.assetSha256,
    byteSize: record.byteSize,
    format: record.format,
    referenceCount: 0 as const,
    warnings: [],
    disposition: "deferred-no-delete" as const,
  };
  const report = (snapshot: string): WorksAssetCleanupReport => ({
    ...cleanupReport(snapshot),
    candidates: [candidate],
  });
  let ledger = createWorksAssetCandidateLedger({
    minimumCompleteObservations: 2,
    minimumAgeMs: 1,
  });
  ledger = observeWorksAssetCleanupReport(
    ledger,
    report("1".repeat(64)),
    "2026-07-01T00:00:00Z",
  );
  return observeWorksAssetCleanupReport(
    ledger,
    report("2".repeat(64)),
    "2026-07-02T00:00:00Z",
  );
};

test("quarantine retention requires age and distinct matching observations", () => {
  const policy = { minimumAgeMs: 86_400_000, minimumObservations: 2 };
  assert.equal(
    assessWorksAssetQuarantineRetention(
      record,
      recordHash,
      observations.slice(0, 1),
      policy,
      "2026-08-03T00:00:00Z",
    ).ok,
    false,
  );
  assert.equal(
    assessWorksAssetQuarantineRetention(
      record,
      recordHash,
      observations,
      policy,
      "2026-08-03T00:00:00Z",
    ).ok,
    true,
  );
  assert.equal(
    assessWorksAssetQuarantineRetention(
      record,
      recordHash,
      observations,
      { ...policy, minimumAgeMs: 3 * 86_400_000 },
      "2026-08-03T00:00:00Z",
    ).ok,
    false,
  );
});

test("review and explicit confirmation are deterministic and asset-bound", () => {
  const review = createWorksAssetDeletionReview({
    record,
    recordSha256: recordHash,
    ledgerSha256: "e".repeat(64),
    finalSnapshotSha256: "d".repeat(64),
    reviewedAt: "2026-08-03T00:00:00Z",
    retentionEvidence: [...observations].reverse(),
  });
  const confirmation = explicitlyConfirmWorksAssetDeletion(
    review,
    "2026-08-03T00:01:00Z",
  );
  assert.equal(
    createWorksAssetDeletionReview({
      record,
      recordSha256: recordHash,
      ledgerSha256: "e".repeat(64),
      finalSnapshotSha256: "d".repeat(64),
      reviewedAt: "2026-08-03T00:00:00Z",
      retentionEvidence: observations,
    }).reviewIdentity,
    review.reviewIdentity,
  );
  const assessment = assessWorksAssetFinalDeletion({
    ledger: retainedLedger(),
    ledgerSha256: "e".repeat(64),
    expectedLedgerSha256: "e".repeat(64),
    record,
    recordSha256: recordHash,
    expectedRecordSha256: recordHash,
    report: cleanupReport(),
    expectedSnapshotSha256: "d".repeat(64),
    sourceCanonicalPathExists: false,
    retentionSatisfied: true,
    confirmation,
  });
  assert.equal(assessment.ok, true);
  assert.deepEqual(
    assessWorksAssetFinalDeletion({
      ledger: retainedLedger(),
      ledgerSha256: "e".repeat(64),
      expectedLedgerSha256: "e".repeat(64),
      record,
      recordSha256: recordHash,
      expectedRecordSha256: recordHash,
      report: cleanupReport("f".repeat(64)),
      expectedSnapshotSha256: "f".repeat(64),
      sourceCanonicalPathExists: false,
      retentionSatisfied: true,
      confirmation,
    }),
    { ok: false, code: "stale-confirmation" },
  );
});

test("final audit fails closed for graph, reference, identity, and evidence drift", () => {
  const base = {
    ledger: retainedLedger(),
    ledgerSha256: "e".repeat(64),
    expectedLedgerSha256: "e".repeat(64),
    record,
    recordSha256: recordHash,
    expectedRecordSha256: recordHash,
    report: cleanupReport(),
    sourceCanonicalPathExists: false,
    retentionSatisfied: true,
  };
  assert.deepEqual(
    assessWorksAssetFinalDeletion({
      ...base,
      report: { ...base.report, referenceGraphComplete: false },
    }),
    { ok: false, code: "graph-incomplete" },
  );
  assert.deepEqual(
    assessWorksAssetFinalDeletion({
      ...base,
      report: {
        ...base.report,
        audit: [{ name: "orphan.png", code: "asset-reference-missing" }],
      },
    }),
    { ok: false, code: "audit-error" },
  );
  assert.deepEqual(
    assessWorksAssetFinalDeletion({
      ...base,
      sourceCanonicalPathExists: true,
      sourceCanonicalIdentityMatchesQuarantined: false,
    }),
    { ok: false, code: "identity-drift" },
  );
  assert.deepEqual(
    assessWorksAssetFinalDeletion({
      ...base,
      expectedRecordSha256: "0".repeat(64),
    }),
    { ok: false, code: "record-drift" },
  );
  assert.deepEqual(
    assessWorksAssetFinalDeletion({
      ...base,
      expectedLedgerSha256: "0".repeat(64),
    }),
    { ok: false, code: "ledger-drift" },
  );
});

test("deletion manifest serialization and hash are deterministic", () => {
  const review = createWorksAssetDeletionReview({
    record,
    recordSha256: recordHash,
    ledgerSha256: "e".repeat(64),
    finalSnapshotSha256: "d".repeat(64),
    reviewedAt: "2026-08-03T00:00:00Z",
    retentionEvidence: observations,
  });
  const confirmation = explicitlyConfirmWorksAssetDeletion(
    review,
    "2026-08-03T00:01:00Z",
  );
  const manifest = createWorksAssetDeletionManifest({
    review,
    confirmation,
    record,
    lockIdentity: "delete-lock",
    preparedAt: "2026-08-03T00:02:00Z",
  });
  assert.equal(
    hashWorksAssetDeletionManifest(manifest),
    hashWorksAssetDeletionManifest(manifest),
  );
  assert.equal(
    serializeWorksAssetDeletionManifest(manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
});
