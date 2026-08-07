import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createJournalEditorDraft } from "./journal-draft-state.ts";
import {
  inspectJournalPublish,
  JournalPublishError,
  publishSavedJournalEntry,
} from "./journal-publish.ts";
import { readJournalEditorEntry } from "./journal-state.ts";

const execFile = promisify(execFileCallback);
const fixture = path.resolve(
  "src/content-loaders/journal/fixtures/valid-public",
);

async function git(root: string, ...args: string[]) {
  const { stdout } = await execFile("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function withRepository(
  run: (repository: string, remote: string) => Promise<void>,
) {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "journal-publish-"),
  );
  const repository = path.join(temporary, "work");
  const remote = path.join(temporary, "remote.git");
  try {
    await fs.mkdir(path.join(repository, "src/content/journal/valid-public"), {
      recursive: true,
    });
    await fs.cp(
      fixture,
      path.join(repository, "src/content/journal/valid-public"),
      {
        recursive: true,
      },
    );
    await fs.writeFile(path.join(repository, "unrelated.txt"), "initial\n");
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "user.name", "Editor Test");
    await git(repository, "config", "user.email", "editor@example.test");
    await git(repository, "add", "--", ".");
    await git(repository, "commit", "-m", "Initial");
    await git(temporary, "init", "--bare", remote);
    await git(repository, "remote", "add", "origin", remote);
    await git(repository, "push", "-u", "origin", "main");
    await run(repository, remote);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function savedDraft(repository: string) {
  return createJournalEditorDraft(
    await readJournalEditorEntry(
      "valid-public",
      path.join(repository, "src/content/journal"),
    ),
  );
}

test("publish stages, commits, and pushes only the canonical three-file unit", async () => {
  await withRepository(async (repository, remote) => {
    const ja = path.join(repository, "src/content/journal/valid-public/ja.md");
    await fs.appendFile(ja, "\nPublished change\n");
    await fs.writeFile(path.join(repository, "unrelated.txt"), "uncommitted\n");
    const draft = await savedDraft(repository);
    const inspection = await inspectJournalPublish("valid-public", repository);
    assert.deepEqual(inspection.files, [
      "src/content/journal/valid-public/ja.md",
    ]);
    assert.match(inspection.diff, /Published change/);

    const result = await publishSavedJournalEntry(
      draft,
      false,
      repository,
      path.join(repository, "src/content/journal"),
    );
    assert.equal(result.state, "published");
    assert.equal(
      await git(repository, "show", "--format=", "--name-only", "HEAD"),
      "src/content/journal/valid-public/ja.md",
    );
    assert.equal(await git(repository, "status", "--short"), "M unrelated.txt");
    assert.equal(
      await git(remote, "rev-parse", "refs/heads/main"),
      result.commit,
    );
  });
});

test("publish reports a committed push failure without losing the commit", async () => {
  await withRepository(async (repository, remote) => {
    const en = path.join(repository, "src/content/journal/valid-public/en.md");
    await fs.appendFile(en, "\nPush failure\n");
    const draft = await savedDraft(repository);
    await fs.rm(remote, { recursive: true, force: true });
    const result = await publishSavedJournalEntry(
      draft,
      false,
      repository,
      path.join(repository, "src/content/journal"),
    );
    assert.equal(result.state, "committed-push-failed");
    assert.equal(await git(repository, "rev-parse", "HEAD"), result.commit);
    assert.match(
      await git(repository, "log", "-1", "--pretty=%s"),
      /^Publish journal: valid-public$/,
    );
  });
});

test("publish fails fast for dirty drafts, blocked capability, and staged changes", async () => {
  await withRepository(async (repository) => {
    const draft = await savedDraft(repository);
    await assert.rejects(
      publishSavedJournalEntry(
        draft,
        true,
        repository,
        path.join(repository, "src/content/journal"),
      ),
      (error: unknown) =>
        error instanceof JournalPublishError && error.code === "dirty-draft",
    );
    if (draft.locales.en.state === "editable")
      draft.locales.en.value.title = "";
    await assert.rejects(
      publishSavedJournalEntry(
        draft,
        false,
        repository,
        path.join(repository, "src/content/journal"),
      ),
      (error: unknown) =>
        error instanceof JournalPublishError &&
        error.code === "publish-blocked",
    );

    await fs.writeFile(path.join(repository, "unrelated.txt"), "staged\n");
    await git(repository, "add", "--", "unrelated.txt");
    await fs.appendFile(
      path.join(repository, "src/content/journal/valid-public/ja.md"),
      "\nchange\n",
    );
    await assert.rejects(
      inspectJournalPublish("valid-public", repository),
      (error: unknown) =>
        error instanceof JournalPublishError &&
        error.code === "unsafe-repository",
    );
  });
});

test("publish inspection rejects detached HEAD and branch/upstream mismatch", async () => {
  await withRepository(async (repository) => {
    await fs.appendFile(
      path.join(repository, "src/content/journal/valid-public/ja.md"),
      "\nchange\n",
    );
    await git(repository, "checkout", "--detach");
    await assert.rejects(
      inspectJournalPublish("valid-public", repository),
      (error: unknown) =>
        error instanceof JournalPublishError &&
        error.code === "unsafe-repository",
    );

    await git(repository, "checkout", "main");
    await git(repository, "branch", "--set-upstream-to", "origin/main");
    await git(repository, "checkout", "-b", "other");
    await git(repository, "branch", "--set-upstream-to", "origin/main");
    await assert.rejects(
      inspectJournalPublish("valid-public", repository),
      (error: unknown) =>
        error instanceof JournalPublishError &&
        error.code === "unsafe-repository",
    );
  });
});
