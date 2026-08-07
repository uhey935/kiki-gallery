import { createHash } from "node:crypto";

import type {
  WorksAssetCleanupCandidate,
  WorksAssetCleanupReport,
} from "./works-asset-cleanup.ts";

export const WORKS_ASSET_LEDGER_SCHEMA_VERSION = 1 as const;

export type WorksAssetRetentionPolicy = {
  minimumCompleteObservations: number;
  minimumAgeMs: number;
};

export type WorksAssetCandidateState =
  | "observing"
  | "retention-satisfied"
  | "resolved-referenced"
  | "superseded-identity-changed"
  | "unknown-graph-incomplete";

export type WorksAssetLedgerObservation = {
  observationId: string;
  observedAt: string;
  snapshotSha256: string;
  referenceGraphComplete: boolean;
  audit: WorksAssetCleanupReport["audit"];
};

export type WorksAssetCandidateLedgerEntry = {
  entryId: string;
  publicUrl: string;
  filename: string;
  assetSha256: string;
  byteSize: number;
  format: WorksAssetCleanupCandidate["format"];
  warnings: WorksAssetCleanupCandidate["warnings"];
  state: WorksAssetCandidateState;
  firstSeen: string;
  lastSeen: string;
  completeObservationCount: number;
  observationIds: string[];
  eligibleForDeletion: false;
};

export type WorksAssetCandidateLedger = {
  schemaVersion: 1;
  mode: "observation-only";
  retentionPolicy: WorksAssetRetentionPolicy;
  entries: WorksAssetCandidateLedgerEntry[];
  observations: WorksAssetLedgerObservation[];
  eligibleForDeletion: false;
};

export type WorksAssetLedgerParseResult =
  | { ok: true; ledger: WorksAssetCandidateLedger }
  | { ok: false; code: "ledger-corrupt"; ledger: null };

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const canonicalTime = (value: string): string => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("invalid-observed-at");
  return new Date(milliseconds).toISOString();
};

const assetIdentity = (candidate: WorksAssetCleanupCandidate) =>
  sha256(
    JSON.stringify({
      publicUrl: candidate.publicUrl,
      sha256: candidate.sha256,
      byteSize: candidate.byteSize,
      format: candidate.format,
    }),
  );
const observationIdentity = (observedAt: string, snapshotSha256: string) =>
  sha256(JSON.stringify({ observedAt, snapshotSha256 }));
const sortedAudit = (audit: WorksAssetCleanupReport["audit"]) =>
  [...audit].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") || a.code.localeCompare(b.code, "en"),
  );

const retentionSatisfied = (
  entry: WorksAssetCandidateLedgerEntry,
  policy: WorksAssetRetentionPolicy,
  observedAt: string,
) =>
  entry.completeObservationCount >= policy.minimumCompleteObservations &&
  Date.parse(observedAt) - Date.parse(entry.firstSeen) >= policy.minimumAgeMs;

export function createWorksAssetCandidateLedger(
  retentionPolicy: WorksAssetRetentionPolicy,
): WorksAssetCandidateLedger {
  if (
    !Number.isSafeInteger(retentionPolicy.minimumCompleteObservations) ||
    retentionPolicy.minimumCompleteObservations < 2 ||
    !Number.isSafeInteger(retentionPolicy.minimumAgeMs) ||
    retentionPolicy.minimumAgeMs < 0
  )
    throw new Error("invalid-retention-policy");
  return {
    schemaVersion: WORKS_ASSET_LEDGER_SCHEMA_VERSION,
    mode: "observation-only",
    retentionPolicy: { ...retentionPolicy },
    entries: [],
    observations: [],
    eligibleForDeletion: false,
  };
}

/** Pure state transition. The caller supplies an explicit observation time. */
export function observeWorksAssetCleanupReport(
  ledger: WorksAssetCandidateLedger,
  report: WorksAssetCleanupReport,
  observedAtInput: string,
): WorksAssetCandidateLedger {
  const observedAt = canonicalTime(observedAtInput);
  const observationId = observationIdentity(observedAt, report.snapshotSha256);
  if (ledger.observations.some((item) => item.observationId === observationId))
    return ledger;

  const reliable = report.referenceGraphComplete && report.audit.length === 0;
  const observation: WorksAssetLedgerObservation = {
    observationId,
    observedAt,
    snapshotSha256: report.snapshotSha256,
    referenceGraphComplete: report.referenceGraphComplete,
    audit: sortedAudit(report.audit),
  };
  let entries = ledger.entries.map((entry) => ({
    ...entry,
    warnings: [...entry.warnings],
    observationIds: [...entry.observationIds],
  }));

  if (!reliable) {
    entries = entries.map((entry) =>
      entry.state === "observing" || entry.state === "retention-satisfied"
        ? {
            ...entry,
            state: "unknown-graph-incomplete" as const,
            completeObservationCount: 0,
            observationIds: [],
            eligibleForDeletion: false as const,
          }
        : entry,
    );
  } else {
    const candidatesByUrl = new Map(
      report.candidates.map((candidate) => [candidate.publicUrl, candidate]),
    );
    entries = entries.map((entry) => {
      const candidate = candidatesByUrl.get(entry.publicUrl);
      const active =
        entry.state === "observing" ||
        entry.state === "retention-satisfied" ||
        entry.state === "unknown-graph-incomplete";
      if (!candidate)
        return active
          ? { ...entry, state: "resolved-referenced" as const }
          : entry;
      if (assetIdentity(candidate) !== entry.entryId)
        return active
          ? { ...entry, state: "superseded-identity-changed" as const }
          : entry;
      const restarting = !active || entry.state === "unknown-graph-incomplete";
      const updated = {
        ...entry,
        filename: candidate.filename,
        warnings: [...candidate.warnings].sort(),
        state: "observing" as WorksAssetCandidateState,
        firstSeen: restarting ? observedAt : entry.firstSeen,
        lastSeen: observedAt,
        completeObservationCount: restarting
          ? 1
          : entry.completeObservationCount + 1,
        observationIds: restarting
          ? [observationId]
          : [...entry.observationIds, observationId],
        eligibleForDeletion: false as const,
      };
      if (retentionSatisfied(updated, ledger.retentionPolicy, observedAt))
        updated.state = "retention-satisfied";
      candidatesByUrl.delete(entry.publicUrl);
      return updated;
    });

    for (const candidate of candidatesByUrl.values()) {
      const entry: WorksAssetCandidateLedgerEntry = {
        entryId: assetIdentity(candidate),
        publicUrl: candidate.publicUrl,
        filename: candidate.filename,
        assetSha256: candidate.sha256,
        byteSize: candidate.byteSize,
        format: candidate.format,
        warnings: [...candidate.warnings].sort(),
        state: "observing",
        firstSeen: observedAt,
        lastSeen: observedAt,
        completeObservationCount: 1,
        observationIds: [observationId],
        eligibleForDeletion: false,
      };
      entries.push(entry);
    }
  }

  return {
    ...ledger,
    entries: entries.sort(
      (a, b) =>
        a.publicUrl.localeCompare(b.publicUrl, "en") ||
        a.entryId.localeCompare(b.entryId, "en"),
    ),
    observations: [...ledger.observations, observation].sort(
      (a, b) =>
        a.observedAt.localeCompare(b.observedAt, "en") ||
        a.observationId.localeCompare(b.observationId, "en"),
    ),
    eligibleForDeletion: false,
  };
}

export function serializeWorksAssetCandidateLedger(
  ledger: WorksAssetCandidateLedger,
): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

export function hashWorksAssetCandidateLedger(
  ledger: WorksAssetCandidateLedger,
): string {
  return sha256(serializeWorksAssetCandidateLedger(ledger));
}

export function parseWorksAssetCandidateLedger(
  serialized: string,
): WorksAssetLedgerParseResult {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isWorksAssetCandidateLedger(value)) throw new Error("invalid-ledger");
    return { ok: true, ledger: value };
  } catch {
    return { ok: false, code: "ledger-corrupt", ledger: null };
  }
}

function isWorksAssetCandidateLedger(
  value: unknown,
): value is WorksAssetCandidateLedger {
  if (!value || typeof value !== "object") return false;
  const ledger = value as Partial<WorksAssetCandidateLedger>;
  if (
    ledger.schemaVersion !== 1 ||
    ledger.mode !== "observation-only" ||
    ledger.eligibleForDeletion !== false ||
    !ledger.retentionPolicy ||
    !Array.isArray(ledger.entries) ||
    !Array.isArray(ledger.observations)
  )
    return false;
  try {
    createWorksAssetCandidateLedger(ledger.retentionPolicy);
  } catch {
    return false;
  }
  const observationIds = new Set<string>();
  for (const item of ledger.observations) {
    if (
      !item ||
      typeof item !== "object" ||
      !isSha256(item.observationId) ||
      !isSha256(item.snapshotSha256) ||
      canonicalTime(item.observedAt) !== item.observedAt ||
      typeof item.referenceGraphComplete !== "boolean" ||
      !Array.isArray(item.audit) ||
      observationIds.has(item.observationId) ||
      observationIdentity(item.observedAt, item.snapshotSha256) !==
        item.observationId
    )
      return false;
    observationIds.add(item.observationId);
  }
  const entryIds = new Set<string>();
  const states: WorksAssetCandidateState[] = [
    "observing",
    "retention-satisfied",
    "resolved-referenced",
    "superseded-identity-changed",
    "unknown-graph-incomplete",
  ];
  for (const entry of ledger.entries) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !isSha256(entry.entryId) ||
      !isSha256(entry.assetSha256) ||
      entryIds.has(entry.entryId) ||
      typeof entry.publicUrl !== "string" ||
      typeof entry.filename !== "string" ||
      !Number.isSafeInteger(entry.byteSize) ||
      entry.byteSize < 0 ||
      !states.includes(entry.state) ||
      entry.eligibleForDeletion !== false ||
      canonicalTime(entry.firstSeen) !== entry.firstSeen ||
      canonicalTime(entry.lastSeen) !== entry.lastSeen ||
      !Number.isSafeInteger(entry.completeObservationCount) ||
      entry.completeObservationCount < 0 ||
      !Array.isArray(entry.observationIds) ||
      new Set(entry.observationIds).size !== entry.observationIds.length ||
      entry.completeObservationCount !== entry.observationIds.length ||
      entry.observationIds.some((id) => !observationIds.has(id)) ||
      !Array.isArray(entry.warnings) ||
      sha256(
        JSON.stringify({
          publicUrl: entry.publicUrl,
          sha256: entry.assetSha256,
          byteSize: entry.byteSize,
          format: entry.format,
        }),
      ) !== entry.entryId ||
      Date.parse(entry.lastSeen) < Date.parse(entry.firstSeen)
    )
      return false;
    entryIds.add(entry.entryId);
  }
  return true;
}
