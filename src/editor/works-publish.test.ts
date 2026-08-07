import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createWorksEditorDraft } from "./works-draft-state.ts";
import {
  inspectWorksPublish,
  publishSavedWorksEntry,
  WorksPublishError,
} from "./works-publish.ts";
import { readWorksEditorEntry } from "./works-state.ts";

const execFile = promisify(execFileCallback);
const source = `---
title: Test Work
artist: test-artist
images:
  - src: /images/test.jpg
    alt: Test image
year: 2026
inquiry:
  type: inquiry
---
Body
`;

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
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "works-publish-"));
  const repository = path.join(temporary, "work");
  const remote = path.join(temporary, "remote.git");
  try {
    await fs.mkdir(path.join(repository, "src/content/works"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repository, "src/content/works/test-work.md"),
      source,
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
  const draft = createWorksEditorDraft(
    await readWorksEditorEntry(
      "test-work",
      path.join(repository, "src/content/works"),
    ),
  );
  assert.ok(draft);
  return draft;
}

test("publish stages, commits, and pushes only one canonical Works file", async () => {
  await withRepository(async (repository, remote) => {
    const target = path.join(repository, "src/content/works/test-work.md");
    await fs.writeFile(target, source.replace("Test Work", "Published Work"));
    await fs.writeFile(path.join(repository, "unrelated.txt"), "uncommitted\n");
    const draft = await savedDraft(repository);
    const inspection = await inspectWorksPublish("test-work", repository);
    assert.equal(inspection.file, "src/content/works/test-work.md");
    assert.match(inspection.diff, /Published Work/);

    const result = await publishSavedWorksEntry(
      draft,
      structuredClone(draft),
      false,
      repository,
      path.join(repository, "src/content/works"),
    );
    assert.equal(result.state, "published");
    assert.equal(
      await git(repository, "show", "--format=", "--name-only", "HEAD"),
      "src/content/works/test-work.md",
    );
    assert.equal(await git(repository, "status", "--short"), "M unrelated.txt");
    assert.equal(
      await git(remote, "rev-parse", "refs/heads/main"),
      result.commit,
    );
    assert.equal(
      await git(repository, "log", "-1", "--pretty=%s"),
      "Publish work: test-work",
    );
  });
});

test("publish separates committed push failure from commit failure", async () => {
  await withRepository(async (repository, remote) => {
    await fs.writeFile(
      path.join(repository, "src/content/works/test-work.md"),
      source.replace("Test Work", "Push Failure"),
    );
    const draft = await savedDraft(repository);
    await fs.rm(remote, { recursive: true, force: true });
    const result = await publishSavedWorksEntry(
      draft,
      structuredClone(draft),
      false,
      repository,
      path.join(repository, "src/content/works"),
    );
    assert.equal(result.state, "committed-push-failed");
    assert.equal(await git(repository, "rev-parse", "HEAD"), result.commit);
  });
});

test("publish rejects dirty, blocked, stale baseline, and pre-staged state", async () => {
  await withRepository(async (repository) => {
    const worksRoot = path.join(repository, "src/content/works");
    const draft = await savedDraft(repository);
    await assert.rejects(
      publishSavedWorksEntry(draft, draft, true, repository, worksRoot),
      (error: unknown) =>
        error instanceof WorksPublishError && error.code === "dirty-draft",
    );
    const unsaved = structuredClone(draft);
    unsaved.data.title = "Unsaved";
    await assert.rejects(
      publishSavedWorksEntry(unsaved, draft, false, repository, worksRoot),
      (error: unknown) =>
        error instanceof WorksPublishError && error.code === "dirty-draft",
    );
    const blocked = structuredClone(draft);
    blocked.data.images[0].alt = "";
    await assert.rejects(
      publishSavedWorksEntry(blocked, blocked, false, repository, worksRoot),
      (error: unknown) =>
        error instanceof WorksPublishError && error.code === "publish-blocked",
    );
    await fs.writeFile(
      path.join(worksRoot, "test-work.md"),
      source.replace("Test Work", "External"),
    );
    await assert.rejects(
      publishSavedWorksEntry(draft, draft, false, repository, worksRoot),
      (error: unknown) =>
        error instanceof WorksPublishError &&
        error.code === "canonical-mismatch",
    );
    await fs.writeFile(path.join(repository, "unrelated.txt"), "staged\n");
    await git(repository, "add", "--", "unrelated.txt");
    await assert.rejects(
      inspectWorksPublish("test-work", repository),
      (error: unknown) =>
        error instanceof WorksPublishError &&
        error.code === "unsafe-repository",
    );
  });
});

test("publish inspection rejects detached HEAD, missing upstream, and mismatch", async () => {
  await withRepository(async (repository) => {
    const target = path.join(repository, "src/content/works/test-work.md");
    await fs.appendFile(target, "\nchange\n");
    await git(repository, "checkout", "--detach");
    await assert.rejects(
      inspectWorksPublish("test-work", repository),
      WorksPublishError,
    );

    await git(repository, "checkout", "main");
    await git(repository, "checkout", "-b", "no-upstream");
    await assert.rejects(
      inspectWorksPublish("test-work", repository),
      WorksPublishError,
    );

    await git(repository, "branch", "--set-upstream-to", "origin/main");
    await assert.rejects(
      inspectWorksPublish("test-work", repository),
      (error: unknown) =>
        error instanceof WorksPublishError &&
        error.code === "unsafe-repository",
    );
  });
});
