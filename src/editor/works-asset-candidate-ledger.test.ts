import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorksAssetCandidateLedger,
  hashWorksAssetCandidateLedger,
  observeWorksAssetCleanupReport,
  parseWorksAssetCandidateLedger,
  serializeWorksAssetCandidateLedger,
} from "./works-asset-candidate-ledger.ts";
import type { WorksAssetCleanupReport } from "./works-asset-cleanup.ts";

const DAY = 86_400_000;
const candidate = (sha256 = "a".repeat(64)) => ({
  publicUrl: "/images/works/orphan.png",
  filename: "orphan.png",
  sha256,
  byteSize: 123,
  format: "png" as const,
  referenceCount: 0 as const,
  warnings: ["noncanonical-filename" as const],
  disposition: "deferred-no-delete" as const,
});
const report = (
  snapshot: string,
  candidates = [candidate()],
  complete = true,
): WorksAssetCleanupReport => ({
  schemaVersion: 1,
  mode: "read-only",
  referenceGraphComplete: complete,
  eligibleForDeletion: false,
  snapshotSha256: snapshot.repeat(64),
  candidates: complete ? candidates : [],
  audit: complete
    ? []
    : [{ name: "broken.md", code: "asset-reference-invalid" }],
});
const initial = () =>
  createWorksAssetCandidateLedger({
    minimumCompleteObservations: 2,
    minimumAgeMs: 7 * DAY,
  });
const observe = (
  ledger: ReturnType<typeof initial>,
  value: WorksAssetCleanupReport,
  day: number,
) =>
  observeWorksAssetCleanupReport(
    ledger,
    value,
    new Date(Date.UTC(2026, 7, 1 + day)).toISOString(),
  );

test("first orphan observation starts an evidence-only candidate", () => {
  const ledger = observe(initial(), report("a"), 0);
  assert.equal(ledger.entries[0].state, "observing");
  assert.equal(ledger.entries[0].completeObservationCount, 1);
  assert.equal(ledger.entries[0].eligibleForDeletion, false);
  assert.deepEqual(ledger.entries[0].warnings, ["noncanonical-filename"]);
});

test("retention needs both elapsed time and multiple complete observations", () => {
  const first = observe(initial(), report("a"), 0);
  const tooSoon = observe(first, report("b"), 1);
  assert.equal(tooSoon.entries[0].state, "observing");
  const mature = observe(tooSoon, report("c"), 7);
  assert.equal(mature.entries[0].state, "retention-satisfied");
  assert.equal(mature.entries[0].completeObservationCount, 3);
  assert.equal(mature.eligibleForDeletion, false);
});

test("an incomplete graph interrupts continuity and the next complete scan restarts it", () => {
  const first = observe(initial(), report("a"), 0);
  const unknown = observe(first, report("b", [], false), 3);
  assert.equal(unknown.entries[0].state, "unknown-graph-incomplete");
  assert.equal(unknown.entries[0].completeObservationCount, 0);
  const restarted = observe(unknown, report("c"), 8);
  assert.equal(restarted.entries[0].state, "observing");
  assert.equal(restarted.entries[0].completeObservationCount, 1);
  assert.equal(restarted.entries[0].firstSeen, "2026-08-09T00:00:00.000Z");
});

test("re-reference resolves the candidate while retaining history", () => {
  const first = observe(initial(), report("a"), 0);
  const resolved = observe(first, report("b", []), 1);
  assert.equal(resolved.entries[0].state, "resolved-referenced");
  assert.equal(resolved.entries[0].completeObservationCount, 1);
  assert.equal(resolved.entries.length, 1);
});

test("an exact duplicate observation is idempotent", () => {
  const first = observe(initial(), report("a"), 0);
  const duplicate = observe(first, report("a"), 0);
  assert.strictEqual(duplicate, first);
  assert.equal(duplicate.observations.length, 1);
});

test("asset identity change closes the old generation and starts a new one", () => {
  const first = observe(initial(), report("a"), 0);
  const changed = observe(first, report("b", [candidate("b".repeat(64))]), 1);
  assert.equal(changed.entries.length, 2);
  assert.deepEqual(changed.entries.map((entry) => entry.state).sort(), [
    "observing",
    "superseded-identity-changed",
  ]);
  assert.equal(
    changed.entries.find((entry) => entry.state === "observing")
      ?.completeObservationCount,
    1,
  );
});

test("corrupt or unsupported ledger fails closed", () => {
  assert.deepEqual(parseWorksAssetCandidateLedger("{"), {
    ok: false,
    code: "ledger-corrupt",
    ledger: null,
  });
  const unsupported = { ...initial(), schemaVersion: 2 };
  assert.equal(
    parseWorksAssetCandidateLedger(JSON.stringify(unsupported)).ok,
    false,
  );
});

test("serialization and ledger hash are deterministic and round-trip", () => {
  const ledger = observe(observe(initial(), report("a"), 0), report("b"), 7);
  const serialized = serializeWorksAssetCandidateLedger(ledger);
  const parsed = parseWorksAssetCandidateLedger(serialized);
  assert.equal(parsed.ok, true);
  assert.equal(
    parsed.ok ? serializeWorksAssetCandidateLedger(parsed.ledger) : "",
    serialized,
  );
  assert.equal(
    hashWorksAssetCandidateLedger(ledger),
    hashWorksAssetCandidateLedger(ledger),
  );
  assert.match(hashWorksAssetCandidateLedger(ledger), /^[a-f0-9]{64}$/);
});
