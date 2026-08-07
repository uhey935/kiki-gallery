import assert from "node:assert/strict";
import test from "node:test";

import { createWorksAssetCleanupReport } from "./works-asset-cleanup.ts";
import type { WorksAssetInventory } from "./works-assets.ts";

const asset = (orphan: true | false | "unknown") => ({
  filename: "artist-old.jpg",
  path: "/canonical/artist-old.jpg",
  publicUrl: "/images/works/artist-old.jpg",
  extension: "jpg",
  byteSize: 123,
  sha256: "a".repeat(64),
  format: "avif" as const,
  mime: "image/avif" as const,
  width: 10,
  height: 20,
  frameCount: 1,
  animated: false,
  extensionMatchesFormat: false,
  warnings: ["extension-content-mismatch" as const],
  references: [],
  referenceCount: 0,
  referencedByWorks: [],
  orphan,
});

test("complete inventory produces evidence-only deferred candidates", () => {
  const inventory: WorksAssetInventory = {
    assets: [asset(true)],
    audit: [],
    referenceGraphComplete: true,
  };
  const report = createWorksAssetCleanupReport(inventory);
  assert.equal(report.mode, "read-only");
  assert.equal(report.eligibleForDeletion, false);
  assert.equal(report.candidates.length, 1);
  assert.deepEqual(report.candidates[0], {
    publicUrl: "/images/works/artist-old.jpg",
    filename: "artist-old.jpg",
    sha256: "a".repeat(64),
    byteSize: 123,
    format: "avif",
    referenceCount: 0,
    warnings: ["extension-content-mismatch"],
    disposition: "deferred-no-delete",
  });
  assert.match(report.snapshotSha256, /^[a-f0-9]{64}$/);
});

test("incomplete reference graph fails closed with no candidates", () => {
  const inventory: WorksAssetInventory = {
    assets: [asset("unknown")],
    audit: [
      {
        name: "/images/works/missing.png",
        code: "asset-reference-missing",
      },
    ],
    referenceGraphComplete: false,
  };
  const report = createWorksAssetCleanupReport(inventory);
  assert.equal(report.referenceGraphComplete, false);
  assert.deepEqual(report.candidates, []);
  assert.equal(report.eligibleForDeletion, false);
});

test("cleanup evidence is deterministic across inventory order", () => {
  const first = asset(true);
  const second = {
    ...asset(false),
    filename: "artist-live.jpg",
    publicUrl: "/images/works/artist-live.jpg",
  };
  const a = createWorksAssetCleanupReport({
    assets: [first, second],
    audit: [],
    referenceGraphComplete: true,
  });
  const b = createWorksAssetCleanupReport({
    assets: [second, first],
    audit: [],
    referenceGraphComplete: true,
  });
  assert.equal(a.snapshotSha256, b.snapshotSha256);
});
