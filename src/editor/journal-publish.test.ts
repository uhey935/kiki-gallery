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
    await fs.mkdir(path.join(repository, "public/images/journal"), {
      recursive: true,
    });
    await fs.copyFile(
      path.resolve(
        "public/images/journal/interview-keisuke-matsuda-2026-02-1.jpg",
      ),
      path.join(
        repository,
        "public/images/journal/interview-keisuke-matsuda-2026-02-1.jpg",
      ),
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

async function renameValidPublic(repository: string) {
  await fs.rename(
    path.join(repository, "src/content/journal/valid-public"),
    path.join(repository, "src/content/journal/renamed-public"),
  );
  return createJournalEditorDraft(
    await readJournalEditorEntry(
      "renamed-public",
      path.join(repository, "src/content/journal"),
    ),
  );
}

async function assertRenamePublishRejectedWithoutGitMutation(
  repository: string,
  remote: string,
) {
  const beforeHead = await git(repository, "rev-parse", "HEAD");
  const beforeRemote = await git(remote, "rev-parse", "refs/heads/main");
  const draft = await renameValidPublic(repository);
  await assert.rejects(
    publishSavedJournalEntry(
      draft,
      false,
      repository,
      path.join(repository, "src/content/journal"),
    ),
    (error: unknown) =>
      error instanceof JournalPublishError &&
      error.code === "unsafe-repository",
  );
  assert.equal(await git(repository, "rev-parse", "HEAD"), beforeHead);
  assert.equal(await git(remote, "rev-parse", "refs/heads/main"), beforeRemote);
  assert.equal(await git(repository, "diff", "--cached", "--name-only"), "");
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

test("publish includes all three untracked files from a newly created unit", async () => {
  await withRepository(async (repository) => {
    const source = path.join(repository, "src/content/journal/valid-public");
    const destination = path.join(repository, "src/content/journal/new-public");
    await fs.cp(source, destination, { recursive: true });
    const draft = createJournalEditorDraft(
      await readJournalEditorEntry(
        "new-public",
        path.join(repository, "src/content/journal"),
      ),
    );
    const inspection = await inspectJournalPublish("new-public", repository);
    assert.deepEqual(inspection.files, [
      "src/content/journal/new-public/en.md",
      "src/content/journal/new-public/index.yaml",
      "src/content/journal/new-public/ja.md",
    ]);
    assert.match(inspection.diff, /untracked: .*new-public\/index.yaml/);

    const result = await publishSavedJournalEntry(
      draft,
      false,
      repository,
      path.join(repository, "src/content/journal"),
    );
    assert.equal(result.state, "published");
    assert.deepEqual(
      (await git(repository, "show", "--format=", "--name-only", "HEAD"))
        .split("\n")
        .filter(Boolean)
        .sort(),
      inspection.files,
    );
  });
});

test("publish includes the exact old deletions and new files after Rename", async () => {
  await withRepository(async (repository) => {
    const oldDirectory = path.join(
      repository,
      "src/content/journal/valid-public",
    );
    const newDirectory = path.join(
      repository,
      "src/content/journal/renamed-public",
    );
    await fs.rename(oldDirectory, newDirectory);
    const draft = createJournalEditorDraft(
      await readJournalEditorEntry(
        "renamed-public",
        path.join(repository, "src/content/journal"),
      ),
    );
    const inspection = await inspectJournalPublish(
      "renamed-public",
      repository,
    );
    assert.equal(inspection.files.length, 6);
    assert.equal(
      inspection.files.filter((file) => file.includes("valid-public")).length,
      3,
    );
    assert.equal(
      inspection.files.filter((file) => file.includes("renamed-public")).length,
      3,
    );

    const result = await publishSavedJournalEntry(
      draft,
      false,
      repository,
      path.join(repository, "src/content/journal"),
    );
    assert.equal(result.state, "published");
    assert.equal(
      await git(
        repository,
        "ls-tree",
        "-r",
        "--name-only",
        "HEAD",
        "src/content/journal/valid-public",
      ),
      "",
    );
    assert.match(
      await git(
        repository,
        "ls-tree",
        "-r",
        "--name-only",
        "HEAD",
        "src/content/journal/renamed-public",
      ),
      /index\.yaml/,
    );
  });
});

test("no-evidence Rename Publish rejects a modified Hero before staging", async () => {
  await withRepository(async (repository, remote) => {
    await fs.appendFile(
      path.join(
        repository,
        "public/images/journal/interview-keisuke-matsuda-2026-02-1.jpg",
      ),
      "modified",
    );
    await assertRenamePublishRejectedWithoutGitMutation(repository, remote);
  });
});

test("no-evidence Rename Publish rejects an untracked Hero before staging", async () => {
  await withRepository(async (repository, remote) => {
    const asset =
      "public/images/journal/interview-keisuke-matsuda-2026-02-1.jpg";
    const bytes = await fs.readFile(path.join(repository, asset));
    await fs.rm(path.join(repository, asset));
    await git(repository, "add", "-A", "--", asset);
    await git(repository, "commit", "-m", "Remove tracked Hero fixture");
    await git(repository, "push", "origin", "main");
    await fs.writeFile(path.join(repository, asset), bytes);
    await assertRenamePublishRejectedWithoutGitMutation(repository, remote);
  });
});

test("no-evidence Rename Publish rejects a missing Hero before staging", async () => {
  await withRepository(async (repository, remote) => {
    await fs.rm(
      path.join(
        repository,
        "public/images/journal/interview-keisuke-matsuda-2026-02-1.jpg",
      ),
    );
    await assertRenamePublishRejectedWithoutGitMutation(repository, remote);
  });
});

test("no-evidence Rename Publish rejects an unsafe Hero before staging", async () => {
  await withRepository(async (repository, remote) => {
    const asset = path.join(
      repository,
      "public/images/journal/interview-keisuke-matsuda-2026-02-1.jpg",
    );
    await fs.rm(asset);
    await fs.symlink(path.join(repository, "unrelated.txt"), asset);
    await assertRenamePublishRejectedWithoutGitMutation(repository, remote);
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
