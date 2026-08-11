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
  ExhibitionsRenameError,
  planExhibitionsRename,
} from "./exhibitions-rename.ts";

const execFile = promisify(execFileCallback);
async function git(root: string, ...args: string[]) {
  return (
    await execFile("git", args, { cwd: root, encoding: "utf8" })
  ).stdout.trim();
}

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

test("reviewed Exhibitions Rename moves the source and byte-preservingly rewrites every known News link", async () => {
  await withRepository(async (repository) => {
    const oldId = "reiko-kinoshita-2023-12";
    const newId = "reiko-kinoshita-renamed";
    const source = path.join(repository, `src/content/exhibitions/${oldId}.md`);
    const sourceBytes = await fs.readFile(source);
    const shared = path.join(
      repository,
      "src/content/news/2023-11-20/index.yaml",
    );
    const sharedBefore = await fs.readFile(shared, "utf8");
    const ja = path.join(repository, "src/content/news/2023-11-20/ja.md");
    const en = path.join(repository, "src/content/news/2023-11-20/en.md");
    const localeBytes = await Promise.all([fs.readFile(ja), fs.readFile(en)]);
    const plan = await planExhibitionsRename({
      repositoryRoot: repository,
      sourceContentId: oldId,
      destinationContentId: newId,
    });
    assert.equal(plan.referenceEdits.length, 1);
    assert.deepEqual(plan.oldRoutes, [`/exhibitions/${oldId}/`]);
    const result = await executeExhibitionsRename(plan, repository);
    assert.equal(result.draft.contentId, newId);
    assert.equal(await fs.lstat(source).catch(() => undefined), undefined);
    assert.deepEqual(
      await fs.readFile(
        path.join(repository, `src/content/exhibitions/${newId}.md`),
      ),
      sourceBytes,
    );
    assert.equal(
      await fs.readFile(shared, "utf8"),
      sharedBefore.replace(`/exhibitions/${oldId}`, `/exhibitions/${newId}`),
    );
    assert.deepEqual(await fs.readFile(ja), localeBytes[0]);
    assert.deepEqual(await fs.readFile(en), localeBytes[1]);
    const evidence = JSON.parse(
      await fs.readFile(
        path.join(
          repository,
          `.kiki-editor/content-lifecycle/operations/${result.operationId}/operation.json`,
        ),
        "utf8",
      ),
    );
    assert.equal(evidence.state, "completed");
    assert.ok(evidence.preimages[plan.sourceFile.file].bytes);
  });
});

test("planning fails closed for invalid IDs, case-fold collision, and unsupported known routes", async () => {
  await withRepository(async (repository) => {
    await assert.rejects(
      planExhibitionsRename({
        repositoryRoot: repository,
        sourceContentId: "bad id",
        destinationContentId: "new-id",
      }),
      (error: unknown) =>
        error instanceof ExhibitionsRenameError &&
        error.code === "invalid-content-id",
    );
    await fs.writeFile(
      path.join(repository, "src/content/exhibitions/Reiko-Renamed.md"),
      "collision",
    );
    await assert.rejects(
      planExhibitionsRename({
        repositoryRoot: repository,
        sourceContentId: "reiko-kinoshita-2023-12",
        destinationContentId: "reiko-renamed",
      }),
      (error: unknown) =>
        error instanceof ExhibitionsRenameError &&
        error.code === "destination-conflict",
    );
    await fs.unlink(
      path.join(repository, "src/content/exhibitions/Reiko-Renamed.md"),
    );
    const news = path.join(
      repository,
      "src/content/news/2023-11-20/index.yaml",
    );
    await fs.writeFile(
      news,
      (await fs.readFile(news, "utf8")).replace(
        "reiko-kinoshita-2023-12",
        "reiko-kinoshita-2023-12?from=x",
      ),
    );
    await assert.rejects(
      planExhibitionsRename({
        repositoryRoot: repository,
        sourceContentId: "reiko-kinoshita-2023-12",
        destinationContentId: "reiko-renamed",
      }),
      (error: unknown) =>
        error instanceof ExhibitionsRenameError &&
        error.code === "reference-rewrite-unsupported",
    );
  });
});

test("execution rejects graph drift and lifecycle lock conflict without mutation", async () => {
  await withRepository(async (repository) => {
    const input = {
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita-2023-12",
      destinationContentId: "reiko-renamed",
    };
    const plan = await planExhibitionsRename(input);
    await fs.appendFile(
      path.join(repository, "src/content/news/2026-03-28/index.yaml"),
      "drift\n",
    );
    await assert.rejects(
      executeExhibitionsRename(plan, repository),
      (error: unknown) =>
        error instanceof ExhibitionsRenameError && error.code === "plan-stale",
    );
    await fs.writeFile(
      path.join(repository, "src/content/news/2026-03-28/index.yaml"),
      (await git(
        repository,
        "show",
        "HEAD:src/content/news/2026-03-28/index.yaml",
      )) + "\n",
    );
    const fresh = await planExhibitionsRename(input);
    await fs.mkdir(
      path.join(repository, ".kiki-editor/content-lifecycle/repository.lock"),
      { recursive: true },
    );
    await assert.rejects(
      executeExhibitionsRename(fresh, repository),
      (error: unknown) =>
        error instanceof ExhibitionsRenameError &&
        error.code === "lifecycle-lock-conflict",
    );
  });
});

test("a post-mutation failure restores every touched file byte-for-byte", async () => {
  await withRepository(async (repository) => {
    const input = {
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita-2023-12",
      destinationContentId: "reiko-renamed",
    };
    const plan = await planExhibitionsRename(input);
    const originals = new Map<string, Buffer>();
    for (const file of plan.touchedPaths.filter(
      (file) => !file.endsWith("reiko-renamed.md"),
    ))
      originals.set(file, await fs.readFile(path.join(repository, file)));
    const originalRename = fs.rename.bind(fs);
    let installs = 0;
    (fs as any).rename = async (oldPath: string, newPath: string) => {
      if (String(oldPath).includes("/staged/") && ++installs === 2)
        throw new Error("injected install failure");
      return originalRename(oldPath, newPath);
    };
    try {
      await assert.rejects(
        executeExhibitionsRename(plan, repository),
        (error: unknown) =>
          error instanceof ExhibitionsRenameError &&
          error.code === "rename-failed-rolled-back",
      );
    } finally {
      (fs as any).rename = originalRename;
    }
    for (const [file, bytes] of originals)
      assert.deepEqual(await fs.readFile(path.join(repository, file)), bytes);
    assert.equal(
      await fs
        .lstat(
          path.join(repository, "src/content/exhibitions/reiko-renamed.md"),
        )
        .catch(() => undefined),
      undefined,
    );
  });
});

test("Publish stages only old/new Exhibition paths and exact evidence reference edits", async () => {
  await withRepository(async (repository, remote) => {
    const plan = await planExhibitionsRename({
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita-2023-12",
      destinationContentId: "reiko-renamed",
    });
    const renamed = await executeExhibitionsRename(plan, repository);
    await fs.writeFile(path.join(repository, "unrelated.txt"), "unrelated\n");
    const result = await publishSavedExhibitionsEntry(
      renamed.draft,
      structuredClone(renamed.draft),
      false,
      repository,
      path.join(repository, "src/content/exhibitions"),
    );
    assert.equal(result.state, "published");
    assert.deepEqual(
      (
        await git(
          repository,
          "show",
          "--format=",
          "--name-only",
          "--no-renames",
          "HEAD",
        )
      )
        .split("\n")
        .filter(Boolean)
        .sort(),
      plan.publishPaths.sort(),
    );
    assert.equal(
      await git(repository, "status", "--short"),
      "?? .kiki-editor/\n?? unrelated.txt",
    );
    assert.equal(
      await git(remote, "rev-parse", "refs/heads/main"),
      result.commit,
    );
  });
});
