import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  executeJournalRename,
  JournalRenameError,
  planJournalRename,
} from "./journal-rename.ts";

const git = promisify(execFile);
const fixture = path.resolve(
  "src/content-loaders/journal/fixtures/valid-public",
);

async function withRepository(run: (repository: string) => Promise<void>) {
  const repository = await fs.mkdtemp(
    path.join(os.tmpdir(), "journal-rename-"),
  );
  try {
    const source = path.join(repository, "src/content/journal/old-entry");
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.cp(fixture, source, { recursive: true });
    await git("git", ["init", "-b", "main"], { cwd: repository });
    await git("git", ["config", "user.name", "Editor Test"], {
      cwd: repository,
    });
    await git("git", ["config", "user.email", "editor@example.test"], {
      cwd: repository,
    });
    await git("git", ["add", "."], { cwd: repository });
    await git("git", ["commit", "-m", "Initial"], { cwd: repository });
    await run(repository);
  } finally {
    await fs.rm(repository, { recursive: true, force: true });
  }
}

test("reviewed Rename moves one exact three-file unit and keeps assets untouched", async () => {
  await withRepository(async (repository) => {
    const asset = path.join(repository, "public/images/journal/old-entry.jpg");
    await fs.mkdir(path.dirname(asset), { recursive: true });
    await fs.writeFile(asset, "asset");
    const plan = await planJournalRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    const result = await executeJournalRename(plan, repository);
    assert.equal(result.draft.contentId, "new-entry");
    assert.equal(result.state, "saved-unpublished");
    assert.equal(
      await fs
        .lstat(path.join(repository, "src/content/journal/old-entry"))
        .catch(() => null),
      null,
    );
    assert.deepEqual(
      (
        await fs.readdir(path.join(repository, "src/content/journal/new-entry"))
      ).sort(),
      ["en.md", "index.yaml", "ja.md"],
    );
    assert.equal(await fs.readFile(asset, "utf8"), "asset");
    assert.equal(
      await git("git", ["status", "--short"], { cwd: repository })
        .then(({ stdout }) => stdout.trim())
        .then((value) => value.includes("public/images")),
      false,
    );
  });
});

test("Rename fails closed for invalid IDs, exact and case-fold destinations", async () => {
  await withRepository(async (repository) => {
    await fs.mkdir(path.join(repository, "src/content/journal/New-Entry"));
    await assert.rejects(
      planJournalRename({
        repositoryRoot: repository,
        sourceContentId: "old-entry",
        destinationContentId: "new-entry",
      }),
      (error: unknown) =>
        error instanceof JournalRenameError &&
        error.code === "content-id-collision",
    );
    await assert.rejects(
      planJournalRename({
        repositoryRoot: repository,
        sourceContentId: "old-entry",
        destinationContentId: "../escape",
      }),
      (error: unknown) =>
        error instanceof JournalRenameError &&
        error.code === "invalid-content-id",
    );
  });
});

test("Rename rejects stale reviewed plans and leaves the source intact", async () => {
  await withRepository(async (repository) => {
    const plan = await planJournalRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    await fs.appendFile(
      path.join(repository, "src/content/journal/old-entry/ja.md"),
      "\nexternal change\n",
    );
    await assert.rejects(
      executeJournalRename(plan, repository),
      (error: unknown) =>
        error instanceof JournalRenameError &&
        error.code === "canonical-mismatch",
    );
    assert.equal(
      (
        await fs.lstat(path.join(repository, "src/content/journal/old-entry"))
      ).isDirectory(),
      true,
    );
    assert.equal(
      await fs
        .lstat(path.join(repository, "src/content/journal/new-entry"))
        .catch(() => null),
      null,
    );
  });
});

test("Rename blocks recognized incoming route references", async () => {
  await withRepository(async (repository) => {
    const news = path.join(repository, "src/content/news/example.md");
    await fs.mkdir(path.dirname(news), { recursive: true });
    await fs.writeFile(news, "[read](/journal/old-entry/#section)\n");
    await assert.rejects(
      planJournalRename({
        repositoryRoot: repository,
        sourceContentId: "old-entry",
        destinationContentId: "new-entry",
      }),
      (error: unknown) =>
        error instanceof JournalRenameError &&
        error.code === "unresolved-references",
    );
    assert.equal(
      (
        await fs.lstat(path.join(repository, "src/content/journal/old-entry"))
      ).isDirectory(),
      true,
    );
  });
});

test("Rename rejects a symlinked Editor state root before mutation", async () => {
  await withRepository(async (repository) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "rename-state-"));
    await fs.symlink(outside, path.join(repository, ".kiki-editor"));
    const plan = await planJournalRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    try {
      await assert.rejects(
        executeJournalRename(plan, repository),
        (error: unknown) =>
          error instanceof JournalRenameError &&
          error.code === "unsafe-repository",
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
    assert.equal(
      (
        await fs.lstat(path.join(repository, "src/content/journal/old-entry"))
      ).isDirectory(),
      true,
    );
  });
});

test("post-move verification failure rolls back without a partial destination", async () => {
  await withRepository(async (repository) => {
    const plan = await planJournalRename({
      repositoryRoot: repository,
      sourceContentId: "old-entry",
      destinationContentId: "new-entry",
    });
    const originalRead = fs.readFile.bind(fs);
    let injected = false;
    // A temporary monkey patch makes the first destination hash check fail.
    (fs as any).readFile = async (...args: Parameters<typeof fs.readFile>) => {
      const result = await originalRead(...args);
      if (!injected && String(args[0]).includes("new-entry")) {
        injected = true;
        return Buffer.from("changed") as Awaited<
          ReturnType<typeof fs.readFile>
        >;
      }
      return result;
    };
    try {
      await assert.rejects(executeJournalRename(plan, repository));
    } finally {
      (fs as any).readFile = originalRead;
    }
    assert.equal(
      (
        await fs.lstat(path.join(repository, "src/content/journal/old-entry"))
      ).isDirectory(),
      true,
    );
    assert.equal(
      await fs
        .lstat(path.join(repository, "src/content/journal/new-entry"))
        .catch(() => null),
      null,
    );
  });
});
