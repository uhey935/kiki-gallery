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
  executeArtistsDelete,
  planArtistsDelete,
  publishArtistsDelete,
} from "./artists-delete.ts";

const execFile = promisify(execFileCallback);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (root: string, args: string[]) =>
  execFile("git", args, { cwd: root, encoding: "utf8" }).then(({ stdout }) =>
    stdout.trim(),
  );

async function fixture() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "artists-delete-"));
  const repository = path.join(parent, "repository");
  const unit = path.join(repository, "src/content/artists/delete-me");
  for (const collection of ["artists", "works", "exhibitions", "news", "home"])
    await fs.mkdir(path.join(repository, "src/content", collection), {
      recursive: true,
    });
  await fs.mkdir(path.join(repository, "public/images"), { recursive: true });
  await fs.mkdir(unit);
  await fs.writeFile(
    path.join(unit, "index.yaml"),
    "sort_name: Delete Me\nhero:\n  image: /images/artists/delete-me.jpg\nmedium:\n  - Painting\n",
  );
  for (const locale of ["ja", "en"])
    await fs.writeFile(
      path.join(unit, `${locale}.md`),
      `---\nname: Delete Me\nmedium_label: ${locale === "ja" ? "陶芸" : "Ceramics"}\nshort_bio: Delete me\nhero_alt: Delete me\n---\n`,
    );
  await fs.writeFile(
    path.join(repository, "src/content/home/home.md"),
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

test("Artists Delete requires exact backup bytes and refuses incoming references", async () => {
  const value = await fixture();
  await fs.writeFile(
    path.join(value.unit, "index.yaml"),
    "sort_name: Drifty\nhero:\n  image: /images/artists/delete-me.jpg\nmedium:\n  - Painting\n",
  );
  await assert.rejects(
    () =>
      planArtistsDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "backup-proof-stale",
  );
  await fs.writeFile(
    path.join(value.unit, "index.yaml"),
    "sort_name: Delete Me\nhero:\n  image: /images/artists/delete-me.jpg\nmedium:\n  - Painting\n",
  );
  const incomingNews = path.join(value.repository, "src/content/news/incoming");
  await fs.mkdir(incomingNews);
  await fs.writeFile(
    path.join(incomingNews, "index.yaml"),
    "date: 2026-08-09\nnews_type: artist\nlink: /artists/delete-me/\nshow_on_home: false\n",
  );
  for (const locale of ["ja", "en"])
    await fs.writeFile(
      path.join(incomingNews, `${locale}.md`),
      `---\ntitle: Artist News ${locale}\n---\n`,
    );
  await assert.rejects(
    () =>
      planArtistsDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "incoming-reference",
  );
  await fs.writeFile(
    path.join(incomingNews, "ja.md"),
    "---\ntitle: Artist News ja\n---\n[Unknown internal route](/unsupported/delete-me/)\n",
  );
  await fs.writeFile(
    path.join(incomingNews, "index.yaml"),
    "date: 2026-08-09\nnews_type: artist\nshow_on_home: false\n",
  );
  await assert.rejects(
    () =>
      planArtistsDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "parser-uncertainty",
  );
  await fs.rm(incomingNews, { recursive: true });
  const work = path.join(value.repository, "src/content/works/incoming");
  await fs.mkdir(work);
  await fs.writeFile(
    path.join(work, "index.yaml"),
    "artist: delete-me\nimages:\n  - src: /images/works/incoming.jpg\ninquiry:\n  type: none\n",
  );
  await fs.writeFile(
    path.join(work, "ja.md"),
    "---\ntitle: Incoming\nimages:\n  - alt: Incoming\n---\n",
  );
  await fs.writeFile(
    path.join(work, "en.md"),
    "---\ntitle: Incoming EN\nimages:\n  - alt: Incoming EN\n---\n",
  );
  await assert.rejects(
    () =>
      planArtistsDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "incoming-reference",
  );
  await fs.rm(work, { recursive: true });
  const exhibition = path.join(
    value.repository,
    "src/content/exhibitions/incoming",
  );
  await fs.mkdir(exhibition);
  await fs.writeFile(
    path.join(exhibition, "index.yaml"),
    "artists:\n  - delete-me\nworks: []\nhero:\n  image: /images/exhibitions/incoming.jpg\n  orientation: landscape\nstart_date: 2026-08-09\nend_date: 2026-08-10\n",
  );
  for (const locale of ["ja", "en"])
    await fs.writeFile(
      path.join(exhibition, `${locale}.md`),
      "---\ntitle: Incoming\nhero_alt: Incoming\n---\n",
    );
  await assert.rejects(
    () =>
      planArtistsDelete({
        repositoryRoot: value.repository,
        contentId: "delete-me",
        backupRoot: value.backup,
      }),
    (error: Error & { code?: string }) => error.code === "incoming-reference",
  );
});

test("reviewed Artists Delete moves the complete unit, records evidence, and Publish stages only evidence paths", async () => {
  const value = await fixture();
  const plan = await planArtistsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  const result = await executeArtistsDelete(plan, value.repository);
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
    path.join(value.repository, "src/content/home/home.md"),
    "unrelated change\n",
  );
  const published = await publishArtistsDelete(
    plan.operationId,
    value.repository,
  );
  assert.deepEqual(
    published.files,
    plan.preimages.map((item) => item.path).sort(),
  );
  assert.equal(
    await git(value.repository, ["show", "--name-only", "--format=", "HEAD"]),
    plan.preimages
      .map((item) => item.path)
      .sort()
      .join("\n"),
  );
  assert.match(await git(value.repository, ["status", "--short"]), /home\.md/);
});

test("Artists Delete detects drift and non-stealing lock conflicts", async () => {
  const value = await fixture();
  const plan = await planArtistsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await fs.appendFile(path.join(value.unit, "index.yaml"), "drift: true\n");
  await assert.rejects(
    () => executeArtistsDelete(plan, value.repository),
    (error: Error & { code?: string }) => error.code === "plan-stale",
  );
  await fs.writeFile(
    path.join(value.unit, "index.yaml"),
    "sort_name: Delete Me\nhero:\n  image: /images/artists/delete-me.jpg\nmedium:\n  - Painting\n",
  );
  const fresh = await planArtistsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  const lock = await acquireContentLifecycleLock({
    repositoryRoot: value.repository,
    writer: "save",
  });
  await assert.rejects(
    () => executeArtistsDelete(fresh, value.repository),
    (error: Error & { code?: string }) => error.code === "lock-conflict",
  );
  await releaseContentLifecycleLock(value.repository, lock.identity);
});

test("any post-move failure atomically rolls the original bytes back", async () => {
  const value = await fixture();
  const plan = await planArtistsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await assert.rejects(
    () =>
      executeArtistsDelete(plan, value.repository, {
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
  const plan = await planArtistsDelete({
    repositoryRoot: value.repository,
    contentId: "delete-me",
    backupRoot: value.backup,
  });
  await assert.rejects(
    () =>
      executeArtistsDelete(plan, value.repository, {
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
