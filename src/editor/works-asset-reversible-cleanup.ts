import { createHash } from "node:crypto";
import path from "node:path";

import type {
  WorksAssetCandidateLedger,
  WorksAssetCandidateLedgerEntry,
} from "./works-asset-candidate-ledger.ts";
import type { WorksAssetCleanupReport } from "./works-asset-cleanup.ts";

export const WORKS_ASSET_QUARANTINE_SCHEMA_VERSION = 1 as const;

export type WorksAssetQuarantineRecord = {
  schemaVersion: 1;
  recordId: string;
  state: "quarantined" | "restored";
  publicUrl: string;
  originalRelativePath: string;
  quarantineRelativePath: string;
  assetSha256: string;
  byteSize: number;
  format: WorksAssetCandidateLedgerEntry["format"];
  quarantinedAt: string;
  restoredAt: string | null;
  sourceSnapshotSha256: string;
  sourceLedgerSha256: string;
  lockIdentity: string;
  restoreLockIdentity: string | null;
  reason: "retention-satisfied-fresh-re-audit";
  eligibleForDeletion: false;
};

export type QuarantineAssessment =
  | { ok: true; entry: WorksAssetCandidateLedgerEntry }
  | {
      ok: false;
      code:
        | "ledger-not-retained"
        | "re-audit-incomplete"
        | "re-audit-error"
        | "re-referenced"
        | "identity-changed"
        | "snapshot-mismatch";
    };

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonicalTime = (value: string) => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("invalid-time");
  return new Date(milliseconds).toISOString();
};

export function assessWorksAssetQuarantine(
  ledger: WorksAssetCandidateLedger,
  ledgerSha256: string,
  report: WorksAssetCleanupReport,
  publicUrl: string,
  expectedSnapshotSha256: string,
): QuarantineAssessment {
  const entry = ledger.entries.find(
    (item) =>
      item.publicUrl === publicUrl && item.state === "retention-satisfied",
  );
  if (!entry) return { ok: false, code: "ledger-not-retained" };
  if (!report.referenceGraphComplete)
    return { ok: false, code: "re-audit-incomplete" };
  if (report.audit.length) return { ok: false, code: "re-audit-error" };
  if (report.snapshotSha256 !== expectedSnapshotSha256)
    return { ok: false, code: "snapshot-mismatch" };
  const candidate = report.candidates.find(
    (item) => item.publicUrl === publicUrl,
  );
  if (!candidate) return { ok: false, code: "re-referenced" };
  if (
    candidate.sha256 !== entry.assetSha256 ||
    candidate.byteSize !== entry.byteSize ||
    candidate.format !== entry.format
  )
    return { ok: false, code: "identity-changed" };
  if (!/^[a-f0-9]{64}$/.test(ledgerSha256))
    return { ok: false, code: "snapshot-mismatch" };
  return { ok: true, entry };
}

export function createWorksAssetQuarantineRecord(input: {
  publicUrl: string;
  filename: string;
  assetSha256: string;
  byteSize: number;
  format: WorksAssetCandidateLedgerEntry["format"];
  quarantinedAt: string;
  sourceSnapshotSha256: string;
  sourceLedgerSha256: string;
  lockIdentity: string;
}): WorksAssetQuarantineRecord {
  const quarantinedAt = canonicalTime(input.quarantinedAt);
  const originalRelativePath = path.posix.join(
    "public/images/works",
    input.filename,
  );
  const identity = sha256(
    JSON.stringify({
      publicUrl: input.publicUrl,
      assetSha256: input.assetSha256,
      quarantinedAt,
      sourceLedgerSha256: input.sourceLedgerSha256,
      lockIdentity: input.lockIdentity,
    }),
  );
  return {
    schemaVersion: WORKS_ASSET_QUARANTINE_SCHEMA_VERSION,
    recordId: identity,
    state: "quarantined",
    publicUrl: input.publicUrl,
    originalRelativePath,
    quarantineRelativePath: path.posix.join(
      ".kiki-editor/asset-lifecycle/quarantine/assets",
      identity,
      input.filename,
    ),
    assetSha256: input.assetSha256,
    byteSize: input.byteSize,
    format: input.format,
    quarantinedAt,
    restoredAt: null,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    sourceLedgerSha256: input.sourceLedgerSha256,
    lockIdentity: input.lockIdentity,
    restoreLockIdentity: null,
    reason: "retention-satisfied-fresh-re-audit",
    eligibleForDeletion: false,
  };
}

export const serializeWorksAssetQuarantineRecord = (
  record: WorksAssetQuarantineRecord,
) => `${JSON.stringify(record, null, 2)}\n`;

export const hashWorksAssetQuarantineRecord = (
  record: WorksAssetQuarantineRecord,
) => sha256(serializeWorksAssetQuarantineRecord(record));

export function parseWorksAssetQuarantineRecord(
  serialized: string,
): WorksAssetQuarantineRecord | null {
  try {
    const value = JSON.parse(serialized) as Partial<WorksAssetQuarantineRecord>;
    const filename = path.posix.basename(value.originalRelativePath ?? "");
    if (
      value.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.recordId ?? "") ||
      (value.state !== "quarantined" && value.state !== "restored") ||
      typeof value.publicUrl !== "string" ||
      typeof value.originalRelativePath !== "string" ||
      typeof value.quarantineRelativePath !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.assetSha256 ?? "") ||
      !Number.isSafeInteger(value.byteSize) ||
      (value.byteSize ?? -1) < 0 ||
      canonicalTime(value.quarantinedAt ?? "") !== value.quarantinedAt ||
      (value.restoredAt !== null &&
        canonicalTime(value.restoredAt ?? "") !== value.restoredAt) ||
      !/^[a-f0-9]{64}$/.test(value.sourceSnapshotSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(value.sourceLedgerSha256 ?? "") ||
      typeof value.lockIdentity !== "string" ||
      (value.restoreLockIdentity !== null &&
        typeof value.restoreLockIdentity !== "string") ||
      value.reason !== "retention-satisfied-fresh-re-audit" ||
      value.eligibleForDeletion !== false
    )
      return null;
    if (
      value.publicUrl !== `/images/works/${filename}` ||
      value.originalRelativePath !== `public/images/works/${filename}` ||
      value.quarantineRelativePath !==
        `.kiki-editor/asset-lifecycle/quarantine/assets/${value.recordId}/${filename}` ||
      filename === "." ||
      filename === ".." ||
      filename.includes("\\")
    )
      return null;
    const expectedId = sha256(
      JSON.stringify({
        publicUrl: value.publicUrl,
        assetSha256: value.assetSha256,
        quarantinedAt: value.quarantinedAt,
        sourceLedgerSha256: value.sourceLedgerSha256,
        lockIdentity: value.lockIdentity,
      }),
    );
    if (expectedId !== value.recordId) return null;
    return value as WorksAssetQuarantineRecord;
  } catch {
    return null;
  }
}
