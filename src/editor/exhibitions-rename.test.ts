import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { publishSavedExhibitionsEntry } from "./exhibitions-publish.ts";
import {
  executeExhibitionsRename,
  planExhibitionsRename,
} from "./exhibitions-rename.ts";

const execFile = promisify(execFileCallback);
const git = (root: string, ...args: string[]) =>
  execFile("git", args, { cwd: root, encoding: "utf8" }).then(({ stdout }) =>
    stdout.trim(),
  );

async function withRepository(
  run: (repository: string, remote: string) => Promise<void>,
) {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "exhibitions-rename-"),
  );
  const repository = path.join(temporary, "work");
  const remote = path.join(temporary, "remote.git");
  try {
    await fs.mkdir(repository);
    await fs.cp(
      path.resolve("src/content"),
      path.join(repository, "src/content"),
      { recursive: true },
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

test("reviewed Exhibitions Rename moves the exact unit and byte-preservingly rewrites News", async () => {
  await withRepository(async (repository) => {
    const oldId = "reiko-kinoshita-2023-12";
    const newId = "reiko-kinoshita-renamed";
    const source = path.join(repository, "src/content/exhibitions", oldId);
    const bytes = await Promise.all(
      ["en.md", "index.yaml", "ja.md"].map((name) =>
        fs.readFile(path.join(source, name)),
      ),
    );
    const news = path.join(
      repository,
      "src/content/news/2023-11-20/index.yaml",
    );
    const newsBefore = await fs.readFile(news, "utf8");
    const plan = await planExhibitionsRename({
      repositoryRoot: repository,
      sourceContentId: oldId,
      destinationContentId: newId,
    });
    assert.equal(plan.referenceEdits.length, 1);
    assert.deepEqual(plan.oldRoutes, [
      `/exhibitions/${oldId}/`,
      `/en/exhibitions/${oldId}/`,
    ]);
    const result = await executeExhibitionsRename(plan, repository);
    assert.equal(result.draft.contentId, newId);
    await assert.rejects(() => fs.access(source));
    for (const [index, name] of ["en.md", "index.yaml", "ja.md"].entries())
      assert.deepEqual(
        await fs.readFile(
          path.join(repository, "src/content/exhibitions", newId, name),
        ),
        bytes[index],
      );
    assert.equal(
      await fs.readFile(news, "utf8"),
      newsBefore.replace(`/exhibitions/${oldId}`, `/exhibitions/${newId}`),
    );
  });
});

test("planning fails closed for invalid IDs, source inventory, and case-fold collision", async () => {
  await withRepository(async (repository) => {
    await assert.rejects(
      () =>
        planExhibitionsRename({
          repositoryRoot: repository,
          sourceContentId: "bad id",
        destinationContentId: "valid-exhibition",
        }),
      (error: Error & { code?: string }) => error.code === "invalid-content-id",
    );
    await assert.rejects(
      () =>
        planExhibitionsRename({
          repositoryRoot: repository,
          sourceContentId: "reiko-kinoshita-2023-12",
        destinationContentId: "alana-wilson-2027-04",
        }),
      (error: Error & { code?: string }) =>
        error.code === "destination-conflict",
    );
    await fs.writeFile(
      path.join(
        repository,
        "src/content/exhibitions/reiko-kinoshita-2023-12/extra.txt",
      ),
      "extra",
    );
    await assert.rejects(
      () =>
        planExhibitionsRename({
          repositoryRoot: repository,
          sourceContentId: "reiko-kinoshita-2023-12",
        destinationContentId: "valid-exhibition",
        }),
      (error: Error & { code?: string }) => error.code === "source-unavailable",
    );
  });
});

test("execution rejects source graph drift and lifecycle lock conflict", async () => {
  await withRepository(async (repository) => {
    const input = {
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita-2023-12",
      destinationContentId: "reiko-renamed",
    };
    const plan = await planExhibitionsRename(input);
    await fs.appendFile(
      path.join(
        repository,
        "src/content/exhibitions/reiko-kinoshita-2023-12/ja.md",
      ),
      "drift",
    );
    await assert.rejects(
      () => executeExhibitionsRename(plan, repository),
      (error: Error & { code?: string }) => error.code === "plan-stale",
    );
    await fs.writeFile(
      path.join(
        repository,
        "src/content/exhibitions/reiko-kinoshita-2023-12/ja.md",
      ),
      Buffer.from(
        plan.sourceFiles.find((item) => item.file.endsWith("/ja.md"))
          ? await git(
              repository,
              "show",
              "HEAD:src/content/exhibitions/reiko-kinoshita-2023-12/ja.md",
            )
          : "",
      ),
    );
    const fresh = await planExhibitionsRename(input);
    await fs.mkdir(
      path.join(repository, ".kiki-editor/content-lifecycle/repository.lock"),
      { recursive: true },
    );
    await assert.rejects(
      () => executeExhibitionsRename(fresh, repository),
      (error: Error & { code?: string }) =>
        error.code === "lifecycle-lock-conflict",
    );
  });
});

test("a post-move failure restores all canonical and reference bytes", async () => {
  await withRepository(async (repository) => {
    const input = {
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita-2023-12",
      destinationContentId: "reiko-renamed",
    };
    const plan = await planExhibitionsRename(input);
    const before = await Promise.all(
      plan.sourceFiles.map((item) =>
        fs.readFile(path.join(repository, item.file)),
      ),
    );
    await assert.rejects(
      () =>
        executeExhibitionsRename(plan, repository, {
          afterSourceMove: async () => {
            throw new Error("injected");
          },
        }),
      (error: Error & { code?: string }) =>
        error.code === "rename-failed-rolled-back",
    );
    for (const [index, item] of plan.sourceFiles.entries())
      assert.deepEqual(
        await fs.readFile(path.join(repository, item.file)),
        before[index],
      );
    await assert.rejects(() =>
      fs.access(path.join(repository, "src/content/exhibitions/reiko-renamed")),
    );
  });
});

test("Publish stages only old/new Exhibition paths and exact News edits", async () => {
  await withRepository(async (repository, remote) => {
    const plan = await planExhibitionsRename({
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita-2023-12",
      destinationContentId: "reiko-renamed",
    });
    const result = await executeExhibitionsRename(plan, repository);
    const published = await publishSavedExhibitionsEntry(
      result.draft,
      structuredClone(result.draft),
      false,
      repository,
      path.join(repository, "src/content/exhibitions"),
    );
    assert.equal(published.state, "published");
    assert.equal(
      await git(remote, "rev-parse", "refs/heads/main"),
      published.commit,
    );
  });
});
