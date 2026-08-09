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
  executeExhibitionsDelete,
  planExhibitionsDelete,
  publishExhibitionsDelete,
} from "./exhibitions-delete.ts";

const execFile = promisify(execFileCallback);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (root: string, args: string[]) =>
  execFile("git", args, { cwd: root, encoding: "utf8" }).then(({ stdout }) =>
    stdout.trim(),
  );

async function fixture() {
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), "exhibitions-delete-"),
  );
  const repository = path.join(parent, "repository");
  const unit = path.join(repository, "src/content/exhibitions/delete-me.md");
  for (const collection of ["artists", "works", "exhibitions", "news", "home"])
    await fs.mkdir(path.join(repository, "src/content", collection), {
      recursive: true,
    });
  await fs.mkdir(path.join(repository, "public/images"), { recursive: true });
  await fs.writeFile(
    unit,
    "---\ntitle: Delete me\nartists:\n  - artist-one\nstart_date: 2026-08-09\nend_date: 2026-08-10\nhero:\n  image: /images/exhibitions/delete-me.jpg\n  orientation: landscape\nhero_alt: Delete me\n---\n\nBody\n",
  );
  await fs.writeFile(
    path.join(repository, "src/content/exhibitions/unrelated.md"),
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

test("Exhibitions Delete requires exact backup bytes and refuses incoming references", async () => {
  const value = await fixture();
  await fs.appendFile(value.unit, "drift\n");
  await assert.rejects(
    () =>
      planExhibitionsDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "backup-proof-stale",
  );
  await fs.writeFile(
    value.unit,
    "---\ntitle: Delete me\nartists:\n  - artist-one\nstart_date: 2026-08-09\nend_date: 2026-08-10\nhero:\n  image: /images/exhibitions/delete-me.jpg\n  orientation: landscape\nhero_alt: Delete me\n---\n\nBody\n",
  );
  await fs.writeFile(
    path.join(value.repository, "src/content/news/incoming.md"),
    "---\ntitle: Exhibition News\ndate: 2026-08-09\nnews_type: exhibition\nlink: /exhibitions/delete-me/\nshow_on_home: false\n---\n",
  );
  await assert.rejects(
    () =>
      planExhibitionsDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "incoming-reference",
  );
  await fs.writeFile(
    path.join(value.repository, "src/content/news/incoming.md"),
    "[Unknown internal route](/unsupported/delete-me/)\n",
  );
  await assert.rejects(
    () =>
      planExhibitionsDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "parser-uncertainty",
  );
});

test("reviewed Exhibitions Delete moves the complete unit, records evidence, and Publish stages only evidence paths", async () => {
  const value = await fixture();
  const plan = await planExhibitionsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  const result = await executeExhibitionsDelete(plan, value.repository);
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
    path.join(value.repository, "src/content/exhibitions/unrelated.md"),
    "unrelated change\n",
  );
  const published = await publishExhibitionsDelete(
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

test("Exhibitions Delete detects drift and non-stealing lock conflicts", async () => {
  const value = await fixture();
  const plan = await planExhibitionsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await fs.appendFile(value.unit, "drift\n");
  await assert.rejects(
    () => executeExhibitionsDelete(plan, value.repository),
    (error: Error & { code?: string }) => error.code === "plan-stale",
  );
  await fs.writeFile(
    value.unit,
    "---\ntitle: Delete me\nartists:\n  - artist-one\nstart_date: 2026-08-09\nend_date: 2026-08-10\nhero:\n  image: /images/exhibitions/delete-me.jpg\n  orientation: landscape\nhero_alt: Delete me\n---\n\nBody\n",
  );
  const fresh = await planExhibitionsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  const lock = await acquireContentLifecycleLock({
    repositoryRoot: value.repository,
    writer: "save",
  });
  await assert.rejects(
    () => executeExhibitionsDelete(fresh, value.repository),
    (error: Error & { code?: string }) => error.code === "lock-conflict",
  );
  await releaseContentLifecycleLock(value.repository, lock.identity);
});

test("any post-move failure atomically rolls the original bytes back", async () => {
  const value = await fixture();
  const plan = await planExhibitionsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await assert.rejects(
    () =>
      executeExhibitionsDelete(plan, value.repository, {
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
  const plan = await planExhibitionsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await assert.rejects(
    () =>
      executeExhibitionsDelete(plan, value.repository, {
        afterMove: async () => {
          throw new Error("injected failure");
        },
        beforeRollback: async () => {
          await fs.writeFile(value.unit, "conflict");
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
