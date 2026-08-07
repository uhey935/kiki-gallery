import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorksAssetCandidateLedger } from "./works-asset-candidate-ledger.ts";
import {
  loadWorksAssetCandidateLedger,
  saveWorksAssetCandidateLedger,
  WORKS_ASSET_LEDGER_RELATIVE_PATH,
  WorksAssetLedgerStoreError,
} from "./works-asset-candidate-ledger-store.ts";

const ledger = () =>
  createWorksAssetCandidateLedger({
    minimumCompleteObservations: 2,
    minimumAgeMs: 604_800_000,
  });

test("Editor-only store durably round-trips and detects stale writers", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "works-ledger-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await loadWorksAssetCandidateLedger(root)).status, "missing");
  const firstHash = await saveWorksAssetCandidateLedger(ledger(), null, root);
  const loaded = await loadWorksAssetCandidateLedger(root);
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.ledgerSha256, firstHash);
  await assert.rejects(
    saveWorksAssetCandidateLedger(ledger(), null, root),
    (error: unknown) =>
      error instanceof WorksAssetLedgerStoreError &&
      error.code === "ledger-conflict",
  );
});

test("corrupt durable state fails closed and is never overwritten", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "works-ledger-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, WORKS_ASSET_LEDGER_RELATIVE_PATH);
  await saveWorksAssetCandidateLedger(ledger(), null, root);
  await writeFile(target, "corrupt");
  assert.equal((await loadWorksAssetCandidateLedger(root)).status, "corrupt");
  await assert.rejects(
    saveWorksAssetCandidateLedger(ledger(), null, root),
    (error: unknown) =>
      error instanceof WorksAssetLedgerStoreError &&
      error.code === "ledger-conflict",
  );
});

test("a symlinked ledger directory fails closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "works-ledger-"));
  const outside = await mkdtemp(
    path.join(os.tmpdir(), "works-ledger-outside-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(root, ".kiki-editor"));
  assert.equal((await loadWorksAssetCandidateLedger(root)).status, "corrupt");
  await assert.rejects(
    saveWorksAssetCandidateLedger(ledger(), null, root),
    (error: unknown) =>
      error instanceof WorksAssetLedgerStoreError &&
      error.code === "ledger-unsafe-path",
  );
});
