import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorksAssetCandidateLedger,
  observeWorksAssetCleanupReport,
} from "./works-asset-candidate-ledger.ts";
import type { WorksAssetCleanupReport } from "./works-asset-cleanup.ts";
import {
  assessWorksAssetQuarantine,
  createWorksAssetQuarantineRecord,
  hashWorksAssetQuarantineRecord,
  parseWorksAssetQuarantineRecord,
  serializeWorksAssetQuarantineRecord,
} from "./works-asset-reversible-cleanup.ts";

const candidate = {
  publicUrl: "/images/works/orphan.png",
  filename: "orphan.png",
  sha256: "a".repeat(64),
  byteSize: 3,
  format: "png" as const,
  referenceCount: 0 as const,
  warnings: [],
  disposition: "deferred-no-delete" as const,
};
const report = (
  snapshot: string,
  candidates = [candidate],
  complete = true,
  audit: WorksAssetCleanupReport["audit"] = [],
): WorksAssetCleanupReport => ({
  schemaVersion: 1,
  mode: "read-only",
  referenceGraphComplete: complete,
  eligibleForDeletion: false,
  snapshotSha256: snapshot.repeat(64),
  candidates: complete ? candidates : [],
  audit,
});
const retained = () => {
  let ledger = createWorksAssetCandidateLedger({
    minimumCompleteObservations: 2,
    minimumAgeMs: 1,
  });
  ledger = observeWorksAssetCleanupReport(
    ledger,
    report("a"),
    "2026-08-01T00:00:00.000Z",
  );
  return observeWorksAssetCleanupReport(
    ledger,
    report("b"),
    "2026-08-02T00:00:00.000Z",
  );
};

test("retention-satisfied candidate passes a matching fresh re-audit", () => {
  assert.equal(
    assessWorksAssetQuarantine(
      retained(),
      "c".repeat(64),
      report("b"),
      candidate.publicUrl,
      "b".repeat(64),
    ).ok,
    true,
  );
});

test("fresh re-audit fails closed for incomplete graph and audit error", () => {
  assert.deepEqual(
    assessWorksAssetQuarantine(
      retained(),
      "c".repeat(64),
      report("b", [], false),
      candidate.publicUrl,
      "b".repeat(64),
    ),
    { ok: false, code: "re-audit-incomplete" },
  );
  assert.deepEqual(
    assessWorksAssetQuarantine(
      retained(),
      "c".repeat(64),
      report("b", [candidate], true, [
        { name: "bad", code: "asset-reference-invalid" },
      ]),
      candidate.publicUrl,
      "b".repeat(64),
    ),
    { ok: false, code: "re-audit-error" },
  );
});

test("fresh re-audit rejects re-reference, identity change, and snapshot mismatch", () => {
  assert.deepEqual(
    assessWorksAssetQuarantine(
      retained(),
      "c".repeat(64),
      report("b", []),
      candidate.publicUrl,
      "b".repeat(64),
    ),
    { ok: false, code: "re-referenced" },
  );
  assert.deepEqual(
    assessWorksAssetQuarantine(
      retained(),
      "c".repeat(64),
      report("b", [{ ...candidate, sha256: "d".repeat(64) }]),
      candidate.publicUrl,
      "b".repeat(64),
    ),
    { ok: false, code: "identity-changed" },
  );
  assert.deepEqual(
    assessWorksAssetQuarantine(
      retained(),
      "c".repeat(64),
      report("d"),
      candidate.publicUrl,
      "b".repeat(64),
    ),
    { ok: false, code: "snapshot-mismatch" },
  );
});

test("record serialization and hash are deterministic and corruption fails closed", () => {
  const record = createWorksAssetQuarantineRecord({
    ...candidate,
    assetSha256: candidate.sha256,
    quarantinedAt: "2026-08-07T00:00:00Z",
    sourceSnapshotSha256: "b".repeat(64),
    sourceLedgerSha256: "c".repeat(64),
    lockIdentity: "lock",
  });
  const serialized = serializeWorksAssetQuarantineRecord(record);
  assert.deepEqual(parseWorksAssetQuarantineRecord(serialized), record);
  assert.equal(
    hashWorksAssetQuarantineRecord(record),
    hashWorksAssetQuarantineRecord(record),
  );
  assert.equal(parseWorksAssetQuarantineRecord("{"), null);
  assert.equal(record.eligibleForDeletion, false);
});
