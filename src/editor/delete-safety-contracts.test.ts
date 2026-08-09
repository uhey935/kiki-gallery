import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBackup } from "./backup-recovery.ts";
import {
  persistContentRecoveryRecord,
  plannedDeletePublishPaths,
  provePreDeleteBackup,
  type ContentRecoveryRecord,
} from "./delete-safety-contracts.ts";

const temporary = async () =>
  fs.mkdtemp(path.join(os.tmpdir(), "kiki-delete-contract-"));

test("pre-delete proof binds a verified generation to exact source bytes", async () => {
  const parent = await temporary();
  const repository = path.join(parent, "repository");
  const backup = path.join(parent, "backup");
  await fs.mkdir(path.join(repository, "src/content/news"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repository, "public/images"), { recursive: true });
  await fs.writeFile(
    path.join(repository, "src/content/news/item.md"),
    "source\n",
  );
  const manifest = await createBackup({
    repositoryRoot: repository,
    destination: backup,
    createdAt: "2026-08-09T00:00:00.000Z",
  });
  const source = manifest.files.find(
    (file) => file.path === "src/content/news/item.md",
  )!;
  const proof = await provePreDeleteBackup({
    backupRoot: backup,
    sourcePreimages: [
      { path: source.path, sha256: source.sha256, byteSize: source.byteSize },
    ],
    policyCommit: "a".repeat(40),
    verifiedAt: "2026-08-09T00:01:00.000Z",
  });
  assert.equal(proof.backupId, manifest.backupId);
  await assert.rejects(
    () =>
      provePreDeleteBackup({
        backupRoot: backup,
        sourcePreimages: [
          {
            path: source.path,
            sha256: "0".repeat(64),
            byteSize: source.byteSize,
          },
        ],
        policyCommit: "a".repeat(40),
      }),
    /exact Delete preimage/,
  );
});

test("recovery evidence is durable, terminal, and grants only exact delete paths", async () => {
  const repository = await temporary();
  const operationId = randomUUID();
  const preimage = {
    path: "src/content/news/item.md",
    sha256: "b".repeat(64),
    byteSize: 7,
  };
  const record: ContentRecoveryRecord = {
    schemaVersion: 1,
    operation: "content-delete",
    operationId,
    collection: "news",
    contentId: "item",
    state: "completed",
    planHash: "c".repeat(64),
    repositoryHead: "d".repeat(40),
    backupProof: {
      schemaVersion: 1,
      backupId: "e".repeat(64),
      backupManifestSha256: "f".repeat(64),
      verifiedAt: "2026-08-09T00:00:00.000Z",
      policyCommit: "a".repeat(40),
      sourcePreimages: [preimage],
    },
    preimages: [preimage],
    recoveryPaths: [`recovery/${operationId}/item.md`],
    publishPaths: [preimage.path],
    preparedAt: "2026-08-09T00:00:00.000Z",
    completedAt: "2026-08-09T00:00:01.000Z",
  };
  const target = await persistContentRecoveryRecord(repository, record);
  assert.deepEqual(plannedDeletePublishPaths(record), [preimage.path]);
  assert.equal(
    JSON.parse(await fs.readFile(target, "utf8")).state,
    "completed",
  );
  await assert.rejects(
    () =>
      persistContentRecoveryRecord(repository, {
        ...record,
        state: "rolled-back",
        completedAt: undefined,
      }),
    /transition/,
  );
  assert.throws(
    () =>
      plannedDeletePublishPaths({
        ...record,
        publishPaths: ["public/images/item.jpg"],
      }),
    /Invalid content recovery/,
  );
});
