import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createBackup } from "./backup-recovery.ts";
import {
  executeWorksDelete,
  planWorksDelete,
  publishWorksDelete,
  WorksDeleteError,
} from "./works-delete.ts";
import {
  acquireWorksAssetRepositoryLock,
  releaseWorksAssetRepositoryLock,
} from "./works-asset-repository-lock.ts";

const execFile = promisify(execFileCallback);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (root: string, args: string[]) =>
  execFile("git", args, { cwd: root, encoding: "utf8" }).then(({ stdout }) =>
    stdout.trim(),
  );
const source = `---\ntitle: Delete Me\nartist: fixture-artist\nimages:\n  - src: /images/works/delete-me.png\n    alt: Delete me\nsize: 1 x 1\nmaterial: Pixel\ninquiry:\n  type: none\n---\n\nBody\n`;

async function fixture() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "works-delete-"));
  const repository = path.join(parent, "repository");
  for (const collection of [
    "artists",
    "works",
    "exhibitions",
    "news",
    "home",
    "journal",
  ])
    await fs.mkdir(path.join(repository, "src/content", collection), {
      recursive: true,
    });
  await fs.mkdir(path.join(repository, "public/images/works"), {
    recursive: true,
  });
  const unit = path.join(repository, "src/content/works/delete-me.md");
  const asset = path.join(repository, "public/images/works/delete-me.png");
  await fs.writeFile(unit, source);
  await fs.writeFile(asset, png);
  const artist = path.join(repository, "src/content/artists/fixture-artist");
  await fs.mkdir(artist);
  await fs.writeFile(path.join(artist, "index.yaml"), "sort_name: Fixture\nhero:\n  image: /images/artists/fixture.jpg\nmedium:\n  - Painting\n");
  await fs.writeFile(path.join(artist, "ja.md"), "---\nname: Fixture\nshort_bio: Fixture\nhero_alt: Fixture\n---\n");
  await fs.writeFile(path.join(artist, "en.md"), "---\nname: Fixture\nshort_bio: Fixture\nhero_alt: Fixture\n---\n");
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.email", "test@example.test"]);
  await git(repository, ["config", "user.name", "Test"]);
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "fixture"]);
  const backup = path.join(parent, "backup");
  await createBackup({ repositoryRoot: repository, destination: backup });
  return { parent, repository, unit, asset, backup };
}

test("Works Delete gates backup, incoming references, pending state, and asset lock", async () => {
  const value = await fixture();
  await fs.appendFile(value.unit, "drift");
  await assert.rejects(
    planWorksDelete({
      repositoryRoot: value.repository,
      contentId: "delete-me",
      backupRoot: value.backup,
    }),
    (e) => e instanceof WorksDeleteError && e.code === "backup-proof-stale",
  );
  await fs.writeFile(value.unit, source);
  await assert.rejects(
    planWorksDelete({
      repositoryRoot: value.repository,
      contentId: "delete-me",
      backupRoot: value.backup,
      pendingAssetState: true,
    }),
    (e) => e instanceof WorksDeleteError && e.code === "pending-asset-state",
  );
  const newsReference = path.join(value.repository, "src/content/news/ref");
  await fs.mkdir(newsReference);
  await fs.writeFile(
    path.join(newsReference, "index.yaml"),
    "date: 2026-08-09\nnews_type: general\nlink: /works/delete-me/\nshow_on_home: false\n",
  );
  for (const locale of ["ja", "en"])
    await fs.writeFile(
      path.join(newsReference, `${locale}.md`),
      `---\ntitle: Ref ${locale}\n---\n`,
    );
  await assert.rejects(
    planWorksDelete({
      repositoryRoot: value.repository,
      contentId: "delete-me",
      backupRoot: value.backup,
    }),
    (e) => e instanceof WorksDeleteError && e.code === "incoming-reference",
  );
  await fs.writeFile(
    path.join(newsReference, "ja.md"),
    "---\ntitle: Ref ja\n---\n[Unsupported local route](/unsupported/delete-me/)\n",
  );
  await fs.writeFile(
    path.join(newsReference, "index.yaml"),
    "date: 2026-08-09\nnews_type: general\nshow_on_home: false\n",
  );
  await assert.rejects(
    planWorksDelete({
      repositoryRoot: value.repository,
      contentId: "delete-me",
      backupRoot: value.backup,
    }),
    (e) => e instanceof WorksDeleteError && e.code === "parser-uncertainty",
  );
  await fs.rm(newsReference, { recursive: true });
  const plan = await planWorksDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  const lock = await acquireWorksAssetRepositoryLock(
    value.repository,
    new Date().toISOString(),
  );
  await assert.rejects(
    executeWorksDelete(plan, value.repository),
    (e) => e instanceof WorksDeleteError && e.code === "lock-conflict",
  );
  await releaseWorksAssetRepositoryLock(value.repository, lock.identity);
  await fs.appendFile(value.unit, "drift\n");
  await assert.rejects(
    executeWorksDelete(plan, value.repository),
    (e) => e instanceof WorksDeleteError && e.code === "plan-stale",
  );
});

test("Works Delete moves only Markdown, preserves assets/evidence, rolls back, and publishes one path", async () => {
  const rollback = await fixture();
  const original = await fs.readFile(rollback.unit);
  const assetHash = hash(await fs.readFile(rollback.asset));
  const rollbackPlan = await planWorksDelete({
    repositoryRoot: rollback.repository,
    contentId: "delete-me",
    backupRoot: rollback.backup,
  });
  await assert.rejects(
    executeWorksDelete(rollbackPlan, rollback.repository, {
      afterMove: async () => {
        throw new Error("injected");
      },
    }),
    (e) => e instanceof WorksDeleteError && e.code === "delete-failed",
  );
  assert.deepEqual(await fs.readFile(rollback.unit), original);
  assert.equal(hash(await fs.readFile(rollback.asset)), assetHash);
  const value = await fixture();
  const plan = await planWorksDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  assert.equal(plan.assets[0].consequence, "unreferenced-after-content-delete");
  assert.deepEqual(plan.assetPathChanges, []);
  const result = await executeWorksDelete(plan, value.repository);
  assert.equal(result.state, "deleted-unpublished");
  await assert.rejects(fs.access(value.unit));
  assert.equal(hash(await fs.readFile(value.asset)), assetHash);
  await fs.writeFile(path.join(value.repository, "unrelated.txt"), "unrelated");
  const published = await publishWorksDelete(
    plan.operationId,
    value.repository,
  );
  assert.deepEqual(published.files, ["src/content/works/delete-me.md"]);
  assert.equal(
    await git(value.repository, ["show", "--name-only", "--format=", "HEAD"]),
    "src/content/works/delete-me.md",
  );
  assert.equal(await fs.readFile(value.asset).then(hash), assetHash);
});

test("Works Delete fails closed for symlink and records manual recovery on occupied rollback", async () => {
  const pending = await fixture();
  const manifests = path.join(
    pending.repository,
    ".kiki-editor/asset-lifecycle/deletion-manifests",
  );
  await fs.mkdir(manifests, { recursive: true });
  await fs.writeFile(
    path.join(manifests, "pending.json"),
    JSON.stringify({ state: "prepared" }),
  );
  await assert.rejects(
    planWorksDelete({
      repositoryRoot: pending.repository,
      contentId: "delete-me",
      backupRoot: pending.backup,
    }),
    (e) => e instanceof WorksDeleteError && e.code === "asset-lifecycle-state",
  );
  const unsafe = await fixture();
  const outside = path.join(unsafe.parent, "outside");
  await fs.rename(path.join(unsafe.repository, "public/images/works"), outside);
  await fs.symlink(
    outside,
    path.join(unsafe.repository, "public/images/works"),
  );
  await assert.rejects(
    planWorksDelete({
      repositoryRoot: unsafe.repository,
      contentId: "delete-me",
      backupRoot: unsafe.backup,
    }),
    (e) => e instanceof WorksDeleteError && e.code === "asset-lifecycle-state",
  );
  const value = await fixture();
  const plan = await planWorksDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await assert.rejects(
    executeWorksDelete(plan, value.repository, {
      afterMove: async () => {
        throw new Error("injected");
      },
      beforeRollback: async () => {
        await fs.writeFile(value.unit, "conflict");
      },
    }),
    (e) => e instanceof WorksDeleteError && e.code === "rollback-failed",
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
