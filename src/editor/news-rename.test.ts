import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createNewsEditorDraft } from "./news-draft-state.ts";
import { publishSavedNewsEntry } from "./news-publish.ts";
import {
  executeNewsRename,
  NewsRenameError,
  planNewsRename,
} from "./news-rename.ts";
import { readNewsEditorEntry } from "./news-state.ts";

const execFile = promisify(execFileCallback);
async function git(root: string, ...args: string[]) {
  return (
    await execFile("git", args, { cwd: root, encoding: "utf8" })
  ).stdout.trim();
}
const source = `---\ntitle: Test news\ndate: 2026-01-01\nnews_type: general\nshow_on_home: false\n---\nBody\n`;

async function withRepository(
  run: (repository: string, remote: string) => Promise<void>,
) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "news-rename-"));
  const repository = path.join(temporary, "work");
  const remote = path.join(temporary, "remote.git");
  try {
    await fs.mkdir(path.join(repository, "src/content/news"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repository, "src/content/news/old-entry.md"),
      source,
    );
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "user.name", "Editor Test");
    await git(repository, "config", "user.email", "editor@example.test");
    await git(repository, "add", ".");
    await git(repository, "commit", "-m", "Initial");
    await git(temporary, "init", "--bare", remote);
    await git(repository, "remote", "add", "origin", remote);
    await git(repository, "push", "-u", "origin", "main");
    await run(repository, remote);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

test("reviewed News Rename moves one exact file and records no route or asset move", async () => {
  await withRepository(async (repository) => {
    const asset = path.join(repository, "public/images/news/old-entry.jpg");
    await fs.mkdir(path.dirname(asset), { recursive: true });
    await fs.writeFile(asset, "asset");
    const plan = await planNewsRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    assert.deepEqual(plan.oldRoutes, []);
    assert.deepEqual(plan.newRoutes, []);
    const result = await executeNewsRename(plan, repository);
    assert.equal(result.draft.contentId, "new-entry");
    assert.equal(result.state, "saved-unpublished");
    assert.equal(
      await fs.readFile(
        path.join(repository, "src/content/news/new-entry.md"),
        "utf8",
      ),
      source,
    );
    assert.equal(
      await fs
        .lstat(path.join(repository, "src/content/news/old-entry.md"))
        .catch(() => null),
      null,
    );
    assert.equal(await fs.readFile(asset, "utf8"), "asset");
  });
});

test("News Rename rejects collisions and stale reviewed plans", async () => {
  await withRepository(async (repository) => {
    await fs.writeFile(
      path.join(repository, "src/content/news/New-Entry.md"),
      source,
    );
    await assert.rejects(
      planNewsRename({
        repositoryRoot: repository,
        sourceContentId: "old-entry",
        destinationContentId: "new-entry",
      }),
      (error: unknown) =>
        error instanceof NewsRenameError &&
        error.code === "content-id-collision",
    );
    await fs.unlink(path.join(repository, "src/content/news/New-Entry.md"));
    const plan = await planNewsRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    await fs.appendFile(
      path.join(repository, "src/content/news/old-entry.md"),
      "drift\n",
    );
    await assert.rejects(
      executeNewsRename(plan, repository),
      (error: unknown) =>
        error instanceof NewsRenameError && error.code === "canonical-mismatch",
    );
    assert.ok(
      await fs.lstat(path.join(repository, "src/content/news/old-entry.md")),
    );
  });
});

test("News Publish stages and verifies the exact Rename delete/add pair", async () => {
  await withRepository(async (repository, remote) => {
    const plan = await planNewsRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    const renamed = await executeNewsRename(plan, repository);
    const draft = createNewsEditorDraft(
      await readNewsEditorEntry(
        "new-entry",
        path.join(repository, "src/content/news"),
      ),
    );
    assert.ok(draft);
    const result = await publishSavedNewsEntry(
      renamed.draft,
      draft,
      false,
      repository,
      path.join(repository, "src/content/news"),
    );
    assert.equal(result.state, "published");
    assert.deepEqual(
      (
        await git(repository, "show", "--format=", "--name-status", "HEAD")
      ).split("\n"),
      ["R100\tsrc/content/news/old-entry.md\tsrc/content/news/new-entry.md"],
    );
    assert.equal(
      await git(remote, "rev-parse", "refs/heads/main"),
      result.commit,
    );
  });
});

test("News Rename rejects symlinked roots and active lifecycle locks", async () => {
  await withRepository(async (repository) => {
    const plan = await planNewsRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    await fs.mkdir(
      path.join(repository, ".kiki-editor/content-lifecycle/repository.lock"),
      { recursive: true },
    );
    await assert.rejects(
      executeNewsRename(plan, repository),
      (error: unknown) =>
        error instanceof NewsRenameError && error.code === "lock-conflict",
    );
    assert.ok(
      await fs.lstat(path.join(repository, "src/content/news/old-entry.md")),
    );
  });
});

test("News post-move verification failure restores the exact source", async () => {
  await withRepository(async (repository) => {
    const plan = await planNewsRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    const originalRead = fs.readFile.bind(fs);
    let injected = false;
    (fs as any).readFile = async (...args: Parameters<typeof fs.readFile>) => {
      const result = await originalRead(...args);
      if (!injected && String(args[0]).endsWith("new-entry.md")) {
        injected = true;
        return Buffer.from("changed") as Awaited<
          ReturnType<typeof fs.readFile>
        >;
      }
      return result;
    };
    try {
      await assert.rejects(executeNewsRename(plan, repository));
    } finally {
      (fs as any).readFile = originalRead;
    }
    assert.equal(
      await fs.readFile(
        path.join(repository, "src/content/news/old-entry.md"),
        "utf8",
      ),
      source,
    );
    assert.equal(
      await fs
        .lstat(path.join(repository, "src/content/news/new-entry.md"))
        .catch(() => null),
      null,
    );
  });
});
