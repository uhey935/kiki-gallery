import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLegacyJournalMigrationManifest,
  restoreOriginalBytes,
  writeLegacyJournalMigration,
  type LegacyJournalMigrationManifest,
} from "./migration-manifest.ts";

const evidenceFile = path.resolve(
  "docs/architecture/journal-migration-manifest-2026-08-06.json",
);

test("frozen evidence restores all legacy bytes and drives the atomic migration", async (t) => {
  const evidence = JSON.parse(
    await fs.readFile(evidenceFile, "utf8"),
  ) as LegacyJournalMigrationManifest;
  assert.equal(evidence.mode, "dry-run");
  assert.equal(evidence.count, 9);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "journal-migration-"));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  for (const entry of evidence.entries) {
    await fs.writeFile(
      path.join(temporaryRoot, `${entry.contentId}.md`),
      Buffer.from(entry.originalBase64, "base64"),
    );
  }

  const before = new Map(
    evidence.entries.map((entry) => [
      entry.contentId,
      Buffer.from(entry.originalBase64, "base64"),
    ]),
  );
  const manifest = await createLegacyJournalMigrationManifest(temporaryRoot);
  assert.equal(manifest.count, 9);
  for (const entry of manifest.entries) {
    assert.equal(entry.shared.visibility, "public");
    assert.equal(entry.enPlaceholder.body, "__TODO_EN_BODY__");
    assert.deepEqual(
      Buffer.from(entry.originalBase64, "base64"),
      before.get(entry.contentId),
    );
  }

  await writeLegacyJournalMigration(manifest);
  for (const entry of manifest.entries) {
    await assert.rejects(fs.access(entry.source));
    const ja = await fs.readFile(entry.destinations.ja);
    const bodyStart = ja.indexOf(Buffer.from("\n---\n")) + 5;
    assert.deepEqual(ja.subarray(bodyStart), Buffer.from(entry.bodyBase64, "base64"));
    assert.match(await fs.readFile(entry.destinations.en, "utf8"), /__TODO_EN_BODY__/);
  }

  const restored = restoreOriginalBytes(manifest);
  assert.equal(restored.size, 9);
  for (const entry of manifest.entries) {
    assert.deepEqual(restored.get(entry.source), before.get(entry.contentId));
  }
});
