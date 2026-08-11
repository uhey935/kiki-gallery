import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { publishSavedArtistsEntry } from "./artists-publish.ts";
import {
  executeArtistsRename,
  ArtistsRenameError,
  planArtistsRename,
} from "./artists-rename.ts";
import { materializeLegacyArtistsFixture } from "./test-flat-artists-fixture.ts";

const execFile = promisify(execFileCallback);
async function git(root: string, ...args: string[]) {
  return (
    await execFile("git", args, { cwd: root, encoding: "utf8" })
  ).stdout.trim();
}

async function withRepository(
  run: (repository: string, remote: string) => Promise<void>,
) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "artists-rename-"));
  const repository = path.join(temporary, "work");
  const remote = path.join(temporary, "remote.git");
  try {
    await fs.mkdir(repository);
    await fs.cp(
      path.resolve("src/content"),
      path.join(repository, "src/content"),
      { recursive: true },
    );
    await materializeLegacyArtistsFixture(
      path.join(repository, "src/content/artists"),
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

test("reviewed Artists Rename moves the source and byte-preservingly rewrites Works, Exhibitions, and known News links", async () => {
  await withRepository(async (repository) => {
    const oldId = "reiko-kinoshita";
    const newId = "reiko-kinoshita-renamed";
    const source = path.join(repository, `src/content/artists/${oldId}`);
    const sourceBytes = await Promise.all(["index.yaml", "ja.md", "en.md"].map((name) => fs.readFile(path.join(source, name))));
    const shared = path.join(
      repository,
      "src/content/news/2026-02-14/index.yaml",
    );
    await fs.writeFile(
      shared,
      (await fs.readFile(shared, "utf8")).replace(
        "/artists/keisuke-matsuda",
        `/artists/${oldId}`,
      ),
    );
    await git(repository, "add", shared);
    await git(repository, "commit", "-m", "Add Artist reference fixture");
    await git(repository, "push");
    const sharedBefore = await fs.readFile(shared, "utf8");
    const ja = path.join(repository, "src/content/news/2026-02-14/ja.md");
    const en = path.join(repository, "src/content/news/2026-02-14/en.md");
    const localeBytes = await Promise.all([fs.readFile(ja), fs.readFile(en)]);
    const plan = await planArtistsRename({
      repositoryRoot: repository,
      sourceContentId: oldId,
      destinationContentId: newId,
    });
    assert.equal(
      plan.referenceEdits.filter((edit) => edit.collection === "works").length,
      6,
    );
    assert.equal(
      plan.referenceEdits.filter((edit) => edit.collection === "exhibitions")
        .length,
      2,
    );
    assert.equal(
      plan.referenceEdits.filter((edit) => edit.collection === "news").length,
      1,
    );
    assert.deepEqual(plan.oldRoutes, [`/artists/${oldId}/`]);
    const result = await executeArtistsRename(plan, repository);
    assert.equal(result.draft.contentId, newId);
    assert.equal(await fs.lstat(source).catch(() => undefined), undefined);
    assert.deepEqual(await Promise.all(["index.yaml", "ja.md", "en.md"].map((name) => fs.readFile(path.join(repository, `src/content/artists/${newId}`, name)))), sourceBytes);
    assert.equal(
      await fs.readFile(shared, "utf8"),
      sharedBefore.replace(`/artists/${oldId}`, `/artists/${newId}`),
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
      planArtistsRename({
        repositoryRoot: repository,
        sourceContentId: "bad id",
        destinationContentId: "new-id",
      }),
      (error: unknown) =>
        error instanceof ArtistsRenameError &&
        error.code === "invalid-content-id",
    );
    await fs.writeFile(
      path.join(repository, "src/content/artists/Reiko-Renamed.md"),
      "collision",
    );
    await assert.rejects(
      planArtistsRename({
        repositoryRoot: repository,
        sourceContentId: "reiko-kinoshita",
        destinationContentId: "reiko-renamed",
      }),
      (error: unknown) =>
        error instanceof ArtistsRenameError &&
        error.code === "destination-conflict",
    );
    await fs.unlink(
      path.join(repository, "src/content/artists/Reiko-Renamed.md"),
    );
    const news = path.join(
      repository,
      "src/content/news/2026-02-14/index.yaml",
    );
    await fs.writeFile(
      news,
      (await fs.readFile(news, "utf8")).replace(
        "/artists/keisuke-matsuda",
        "/artists/reiko-kinoshita?from=x",
      ),
    );
    await assert.rejects(
      planArtistsRename({
        repositoryRoot: repository,
        sourceContentId: "reiko-kinoshita",
        destinationContentId: "reiko-renamed",
      }),
      (error: unknown) =>
        error instanceof ArtistsRenameError &&
        error.code === "reference-rewrite-unsupported",
    );
  });
});

test("execution rejects graph drift and lifecycle lock conflict without mutation", async () => {
  await withRepository(async (repository) => {
    const input = {
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita",
      destinationContentId: "reiko-renamed",
    };
    const plan = await planArtistsRename(input);
    await fs.appendFile(
      path.join(repository, "src/content/news/2026-03-28/index.yaml"),
      "drift\n",
    );
    await assert.rejects(
      executeArtistsRename(plan, repository),
      (error: unknown) =>
        error instanceof ArtistsRenameError && error.code === "plan-stale",
    );
    await fs.writeFile(
      path.join(repository, "src/content/news/2026-03-28/index.yaml"),
      (await git(
        repository,
        "show",
        "HEAD:src/content/news/2026-03-28/index.yaml",
      )) + "\n",
    );
    const fresh = await planArtistsRename(input);
    await fs.mkdir(
      path.join(repository, ".kiki-editor/content-lifecycle/repository.lock"),
      { recursive: true },
    );
    await assert.rejects(
      executeArtistsRename(fresh, repository),
      (error: unknown) =>
        error instanceof ArtistsRenameError &&
        error.code === "lifecycle-lock-conflict",
    );
  });
});

test("a post-mutation failure restores every touched file byte-for-byte", async () => {
  await withRepository(async (repository) => {
    const input = {
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita",
      destinationContentId: "reiko-renamed",
    };
    const plan = await planArtistsRename(input);
    const originals = new Map<string, Buffer>();
    for (const file of plan.touchedPaths.filter((file) => !file.startsWith("src/content/artists/reiko-renamed/")))
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
        executeArtistsRename(plan, repository),
        (error: unknown) =>
          error instanceof ArtistsRenameError &&
          error.code === "rename-failed-rolled-back",
      );
    } finally {
      (fs as any).rename = originalRename;
    }
    for (const [file, bytes] of originals)
      assert.deepEqual(await fs.readFile(path.join(repository, file)), bytes);
    assert.equal(
      await fs
        .lstat(path.join(repository, "src/content/artists/reiko-renamed"))
        .catch(() => undefined),
      undefined,
    );
  });
});

test("Publish stages only old/new Artist paths and exact evidence reference edits", async () => {
  await withRepository(async (repository, remote) => {
    const plan = await planArtistsRename({
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita",
      destinationContentId: "reiko-renamed",
    });
    const renamed = await executeArtistsRename(plan, repository);
    await fs.writeFile(path.join(repository, "unrelated.txt"), "unrelated\n");
    const result = await publishSavedArtistsEntry(
      renamed.draft,
      structuredClone(renamed.draft),
      false,
      repository,
      path.join(repository, "src/content/artists"),
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
