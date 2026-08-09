import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  executeWorksRename,
  planWorksRename,
  WorksRenameError,
} from "./works-rename.ts";
import {
  acquireWorksAssetRepositoryLock,
  releaseWorksAssetRepositoryLock,
} from "./works-asset-repository-lock.ts";
import { publishSavedWorksEntry } from "./works-publish.ts";

const execFile = promisify(execFileCallback);
async function git(root: string, ...args: string[]) {
  return (
    await execFile("git", args, { cwd: root, encoding: "utf8" })
  ).stdout.trim();
}

async function withRepository(run: (repository: string) => Promise<void>) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "works-rename-"));
  const repository = path.join(temporary, "work");
  const remote = path.join(temporary, "remote.git");
  try {
    await fs.mkdir(repository);
    await fs.cp(
      path.resolve("src/content"),
      path.join(repository, "src/content"),
      { recursive: true },
    );
    await fs.mkdir(path.join(repository, "public/images"), { recursive: true });
    await fs.cp(
      path.resolve("public/images/works"),
      path.join(repository, "public/images/works"),
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
    await run(repository);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

test("reviewed Works Rename moves byte-identical content, rewrites typed references, and leaves assets unchanged", async () => {
  await withRepository(async (repository) => {
    const oldId = "reiko-kinoshita-01";
    const newId = "reiko-kinoshita-renamed";
    const source = path.join(repository, `src/content/works/${oldId}.md`);
    const sourceBytes = await fs.readFile(source);
    const assetRoot = path.join(repository, "public/images/works");
    const assetBefore = await inventory(assetRoot);
    const plan = await planWorksRename({
      repositoryRoot: repository,
      sourceContentId: oldId,
      destinationContentId: newId,
    });
    assert.ok(
      plan.referenceEdits.some((edit) => edit.collection === "artists"),
    );
    assert.ok(
      plan.referenceEdits.some((edit) => edit.collection === "exhibitions"),
    );
    assert.deepEqual(plan.assetPathChanges, []);
    const result = await executeWorksRename(plan, repository);
    assert.equal(result.draft.contentId, newId);
    assert.equal(await fs.lstat(source).catch(() => undefined), undefined);
    assert.deepEqual(
      await fs.readFile(path.join(repository, `src/content/works/${newId}.md`)),
      sourceBytes,
    );
    assert.deepEqual(await inventory(assetRoot), assetBefore);
    assert.match(
      await fs.readFile(
        path.join(repository, "src/content/artists/reiko-kinoshita.md"),
        "utf8",
      ),
      new RegExp(newId),
    );
    const published = await publishSavedWorksEntry(
      result.draft,
      structuredClone(result.draft),
      false,
      repository,
      path.join(repository, "src/content/works"),
      undefined,
      result.renameEvidence,
    );
    assert.equal(published.state, "published");
    const changed = await git(
      repository,
      "show",
      "--pretty=format:",
      "--name-only",
      "HEAD",
    );
    assert.match(changed, new RegExp(`src/content/works/${newId}\\.md`));
    assert.doesNotMatch(changed, /public\/images|\.kiki-editor/);
  });
});

test("Works Rename fails closed for collision, pending manifest, and asset lock", async () => {
  await withRepository(async (repository) => {
    await assert.rejects(
      planWorksRename({
        repositoryRoot: repository,
        sourceContentId: "reiko-kinoshita-01",
        destinationContentId: "reiko-kinoshita-02",
      }),
      (e) => e instanceof WorksRenameError && e.code === "destination-conflict",
    );
    await assert.rejects(
      planWorksRename({
        repositoryRoot: repository,
        sourceContentId: "reiko-kinoshita-01",
        destinationContentId: "renamed",
        unpublishedAssetCount: 1,
      }),
      (e) =>
        e instanceof WorksRenameError &&
        e.code === "unpublished-asset-manifest",
    );
    const plan = await planWorksRename({
      repositoryRoot: repository,
      sourceContentId: "reiko-kinoshita-01",
      destinationContentId: "renamed",
    });
    const lock = await acquireWorksAssetRepositoryLock(
      repository,
      new Date().toISOString(),
    );
    await assert.rejects(
      executeWorksRename(plan, repository),
      (e) =>
        e instanceof WorksRenameError && e.code === "lifecycle-lock-conflict",
    );
    await releaseWorksAssetRepositoryLock(repository, lock.identity);
  });
});

test("Works Rename detects canonical drift and rolls content/reference bytes back after an install failure", async () => {
  await withRepository(async (repository) => {
    const oldId = "reiko-kinoshita-01";
    const newId = "rollback-work";
    const source = path.join(repository, `src/content/works/${oldId}.md`);
    const plan = await planWorksRename({
      repositoryRoot: repository,
      sourceContentId: oldId,
      destinationContentId: newId,
    });
    const original = await fs.readFile(source);
    await fs.appendFile(source, "\n");
    await assert.rejects(
      executeWorksRename(plan, repository),
      (e) => e instanceof WorksRenameError && e.code === "plan-stale",
    );
    await fs.writeFile(source, original);
    const fresh = await planWorksRename({
      repositoryRoot: repository,
      sourceContentId: oldId,
      destinationContentId: newId,
    });
    const referenceBytes = new Map<string, Buffer>();
    for (const file of new Set(fresh.referenceEdits.map((edit) => edit.file)))
      referenceBytes.set(file, await fs.readFile(path.join(repository, file)));
    const originalRename = fs.rename.bind(fs);
    let installs = 0;
    (fs as any).rename = async (from: string, to: string) => {
      if (from.includes(`${path.sep}staged${path.sep}`) && ++installs === 2)
        throw new Error("injected install failure");
      return originalRename(from, to);
    };
    try {
      await assert.rejects(
        executeWorksRename(fresh, repository),
        (e) =>
          e instanceof WorksRenameError &&
          e.code === "rename-failed-rolled-back",
      );
    } finally {
      (fs as any).rename = originalRename;
    }
    assert.deepEqual(await fs.readFile(source), original);
    assert.equal(
      await fs
        .lstat(path.join(repository, `src/content/works/${newId}.md`))
        .catch(() => undefined),
      undefined,
    );
    for (const [file, bytes] of referenceBytes)
      assert.deepEqual(await fs.readFile(path.join(repository, file)), bytes);
  });
});

test("Works Rename rejects a symlinked canonical asset root", async () => {
  await withRepository(async (repository) => {
    const root = path.join(repository, "public/images/works");
    const moved = `${root}-real`;
    await fs.rename(root, moved);
    await fs.symlink(moved, root);
    await assert.rejects(
      planWorksRename({
        repositoryRoot: repository,
        sourceContentId: "reiko-kinoshita-01",
        destinationContentId: "unsafe-work",
      }),
      (e) =>
        e instanceof WorksRenameError &&
        (e.code === "reference-graph-incomplete" ||
          e.code === "unsafe-repository"),
    );
  });
});

async function inventory(root: string) {
  const result: Array<[string, string]> = [];
  for (const name of (await fs.readdir(root)).sort()) {
    const bytes = await fs.readFile(path.join(root, name));
    result.push([name, Buffer.from(bytes).toString("base64")]);
  }
  return result;
}
