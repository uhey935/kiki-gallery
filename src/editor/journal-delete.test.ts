import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createBackup } from "./backup-recovery.ts";
import {
  acquireContentLifecycleLock,
  releaseContentLifecycleLock,
} from "./content-lifecycle-lock.ts";
import {
  executeJournalDelete,
  planJournalDelete,
  publishJournalDelete,
} from "./journal-delete.ts";

const execFile = promisify(execFileCallback);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (root: string, args: string[]) =>
  execFile("git", args, { cwd: root, encoding: "utf8" }).then(({ stdout }) =>
    stdout.trim(),
  );

async function fixture() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "journal-delete-"));
  const repository = path.join(parent, "repository");
  const unit = path.join(repository, "src/content/journal/delete-me");
  await fs.mkdir(unit, { recursive: true });
  for (const collection of ["artists", "works", "exhibitions", "news", "home"])
    await fs.mkdir(path.join(repository, "src/content", collection), {
      recursive: true,
    });
  await fs.mkdir(path.join(repository, "public/images"), { recursive: true });
  await fs.writeFile(
    path.join(unit, "index.yaml"),
    "date: 2026-08-09\ncategories:\n  - interview\nhero:\n  image: /images/journal/delete-me.jpg\n  hero_caption: Fixture\nauthor: fixture-author\nvisibility: public\n",
  );
  for (const locale of ["ja", "en"])
    await fs.writeFile(
      path.join(unit, `${locale}.md`),
      `---\ntitle: ${locale} title\nsummary: valid summary for delete acceptance.\nhero_alt: Gallery fixture\n---\n\nBody\n`,
    );
  await fs.writeFile(
    path.join(repository, "src/content/news/unrelated.md"),
    "---\ntitle: unrelated\n---\n\nNo reference.\n",
  );
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.email", "acceptance@example.test"]);
  await git(repository, ["config", "user.name", "Acceptance"]);
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "fixture"]);
  const backup = path.join(parent, "backup");
  await createBackup({ repositoryRoot: repository, destination: backup });
  return { parent, repository, unit, backup };
}

test("Journal Delete requires exact backup bytes and refuses incoming references", async () => {
  const value = await fixture();
  await fs.appendFile(path.join(value.unit, "ja.md"), "drift\n");
  await assert.rejects(
    () =>
      planJournalDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "backup-proof-stale",
  );
  await fs.writeFile(
    path.join(value.unit, "ja.md"),
    "---\ntitle: ja title\nsummary: valid summary for delete acceptance.\nhero_alt: Gallery fixture\n---\n\nBody\n",
  );
  await fs.writeFile(
    path.join(value.repository, "src/content/news/incoming.md"),
    "[Journal](/journal/delete-me/)\n",
  );
  await assert.rejects(
    () =>
      planJournalDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "incoming-reference",
  );
});

test("reviewed Journal Delete moves the complete unit, records evidence, and Publish stages only evidence paths", async () => {
  const value = await fixture();
  const plan = await planJournalDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  const result = await executeJournalDelete(plan, value.repository);
  assert.equal(result.state, "deleted-unpublished");
  await assert.rejects(() => fs.access(value.unit));
  for (const recovery of plan.recoveryPaths)
    assert.equal(
      (await fs.readFile(path.join(value.repository, recovery))).byteLength > 0,
      true,
    );
  const evidence = JSON.parse(
    await fs.readFile(
      path.join(
        value.repository,
        ".kiki-editor/content-lifecycle/operations",
        plan.operationId,
        "operation.json",
      ),
      "utf8",
    ),
  );
  assert.equal(evidence.state, "completed");
  await fs.appendFile(
    path.join(value.repository, "src/content/news/unrelated.md"),
    "unrelated change\n",
  );
  const published = await publishJournalDelete(
    plan.operationId,
    value.repository,
  );
  assert.deepEqual(
    published.files,
    plan.preimages.map((item) => item.path),
  );
  assert.equal(
    await git(value.repository, ["show", "--name-only", "--format=", "HEAD"]),
    plan.preimages.map((item) => item.path).join("\n"),
  );
  assert.match(
    await git(value.repository, ["status", "--short"]),
    /unrelated\.md/,
  );
});

test("Journal Delete detects drift and non-stealing lock conflicts", async () => {
  const value = await fixture();
  const plan = await planJournalDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await fs.appendFile(path.join(value.unit, "en.md"), "drift\n");
  await assert.rejects(
    () => executeJournalDelete(plan, value.repository),
    (error: Error & { code?: string }) => error.code === "plan-stale",
  );
  await fs.writeFile(
    path.join(value.unit, "en.md"),
    "---\ntitle: en title\nsummary: valid summary for delete acceptance.\nhero_alt: Gallery fixture\n---\n\nBody\n",
  );
  const fresh = await planJournalDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  const lock = await acquireContentLifecycleLock({
    repositoryRoot: value.repository,
    writer: "save",
  });
  await assert.rejects(
    () => executeJournalDelete(fresh, value.repository),
    (error: Error & { code?: string }) => error.code === "lock-conflict",
  );
  await releaseContentLifecycleLock(value.repository, lock.identity);
});

test("any post-move failure atomically rolls all three original bytes back", async () => {
  const value = await fixture();
  const plan = await planJournalDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await assert.rejects(
    () =>
      executeJournalDelete(plan, value.repository, {
        afterMove: async () => {
          throw new Error("injected failure");
        },
      }),
    (error: Error & { code?: string }) => error.code === "delete-failed",
  );
  for (const preimage of plan.preimages) {
    const restored = await fs.readFile(
      path.join(value.repository, preimage.path),
    );
    assert.equal(restored.byteLength, preimage.byteSize);
    assert.equal(hash(restored), preimage.sha256);
  }
  const evidence = JSON.parse(
    await fs.readFile(
      path.join(
        value.repository,
        ".kiki-editor/content-lifecycle/operations",
        plan.operationId,
        "operation.json",
      ),
      "utf8",
    ),
  );
  assert.equal(evidence.state, "rolled-back");
});

test("uncertain rollback preserves the lifecycle lock and records manual recovery", async () => {
  const value = await fixture();
  const plan = await planJournalDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await assert.rejects(
    () =>
      executeJournalDelete(plan, value.repository, {
        afterMove: async () => {
          throw new Error("injected failure");
        },
        beforeRollback: async () => {
          await fs.mkdir(value.unit);
        },
      }),
    (error: Error & { code?: string }) => error.code === "rollback-failed",
  );
  await fs.access(
    path.join(
      value.repository,
      ".kiki-editor/content-lifecycle/repository.lock/owner.json",
    ),
  );
  const evidence = JSON.parse(
    await fs.readFile(
      path.join(
        value.repository,
        ".kiki-editor/content-lifecycle/operations",
        plan.operationId,
        "operation.json",
      ),
      "utf8",
    ),
  );
  assert.equal(evidence.state, "manual-recovery-required");
});
