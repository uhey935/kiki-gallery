import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { finalizePublishedRename, findRenameEvidence, publishRecordedRenameCommit, recordRenamePushFailure } from "./content-rename-evidence-lifecycle.ts";

const execFile = promisify(execFileCallback);

test("Rename evidence lifecycle fails closed for unknown and recovery states", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  try {
    const operations = path.join(repository, ".kiki-editor/content-lifecycle/operations");
    await fs.mkdir(operations, { recursive: true });
    for (const [operationId, state] of [
      ["11111111-1111-4111-8111-111111111111", "prepared"],
      ["22222222-2222-4222-8222-222222222222", "manual-recovery-required"],
      ["33333333-3333-4333-8333-333333333333", "unknown"],
    ]) {
      const directory = path.join(operations, operationId);
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, "operation.json"), JSON.stringify({
        operation: "artists-rename",
        state,
        plan: {
          operation: "artists-rename",
          operationId,
          sourceContentId: "a",
          destinationContentId: "b",
          repositoryBranch: "main",
          repositoryUpstream: "origin/main",
          sourceFile: { file: "src/content/artists/a/index.yaml" },
        },
      }));
    }
    await assert.rejects(findRenameEvidence(repository, "artists", "b"), /manual recovery/);
    assert.equal((await fs.readdir(operations)).length, 3);
  } finally {
    await fs.rm(repository, { recursive: true, force: true });
  }
});

test("finalization marks evidence published before removing only its exact directory", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  try {
    const operations = path.join(repository, ".kiki-editor/content-lifecycle/operations");
    const operationId = "44444444-4444-4444-8444-444444444444";
    const directory = path.join(operations, operationId);
    const unrelated = path.join(operations, "55555555-5555-4555-8555-555555555555");
    await fs.mkdir(directory, { recursive: true });
    await fs.mkdir(unrelated);
    const file = path.join(directory, "operation.json");
    const record = { state: "completed", operation: "artists-rename", publication: { commit: "a".repeat(40), branch: "main", upstream: "origin/main" }, plan: { operation: "artists-rename", operationId, repositoryBranch: "main", repositoryUpstream: "origin/main" } } as any;
    await fs.writeFile(file, JSON.stringify(record));
    const result = await finalizePublishedRename({ operationId, directory, file, record });
    assert.equal(result.cleaned, true);
    assert.equal(await fs.lstat(directory).catch(() => undefined), undefined);
    assert.ok(await fs.lstat(unrelated));
    assert.ok(await fs.lstat(operations));
  } finally {
    await fs.rm(repository, { recursive: true, force: true });
  }
});

test("cleanup failure leaves durable published evidence inactive", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  try {
    const operationId = "66666666-6666-4666-8666-666666666666";
    const directory = path.join(repository, ".kiki-editor/content-lifecycle/operations", operationId);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, "operation.json");
    const record = {
      state: "completed",
      operation: "artists-rename",
      plan: {
        operation: "artists-rename",
        operationId,
        sourceContentId: "a",
        destinationContentId: "b",
        repositoryBranch: "main",
        repositoryUpstream: "origin/main",
        sourceFile: { file: "src/content/artists/a/index.yaml" },
      },
      publication: { commit: "b".repeat(40), branch: "main", upstream: "origin/main" },
    } as any;
    await fs.writeFile(file, JSON.stringify(record));
    const result = await finalizePublishedRename(
      { operationId, directory, file, record },
      async () => { throw new Error("injected cleanup failure"); },
    );
    assert.equal(result.cleaned, false);
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state, "published");
    assert.equal(await findRenameEvidence(repository, "artists", "b"), undefined);
  } finally {
    await fs.rm(repository, { recursive: true, force: true });
  }
});

test("push-failure primary record write failure remains exactly retryable through its marker", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  try {
    const operationId = "99999999-9999-4999-8999-999999999999";
    const directory = path.join(repository, ".kiki-editor/content-lifecycle/operations", operationId);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, "operation.json");
    const record = { state: "completed", operation: "artists-rename", plan: { operation: "artists-rename", operationId, sourceContentId: "a", destinationContentId: "b", repositoryBranch: "main", repositoryUpstream: "origin/main", sourceFile: { file: "old" } } } as any;
    await fs.writeFile(file, JSON.stringify(record));
    await assert.rejects(recordRenamePushFailure(
      { operationId, directory, file, record }, "c".repeat(40), "main", "origin/main",
      async () => { throw new Error("injected primary write failure"); },
    ));
    const found = await findRenameEvidence(repository, "artists", "b");
    assert.equal(found?.record.state, "committed-push-failed");
    assert.equal(found?.record.publication?.commit, "c".repeat(40));
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state, "completed");
  } finally { await fs.rm(repository, { recursive: true, force: true }); }
});

test("published transition primary write failure is inactive and cannot retry", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  try {
    const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const directory = path.join(repository, ".kiki-editor/content-lifecycle/operations", operationId);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, "operation.json");
    const record = { state: "committed-push-failed", operation: "artists-rename", publication: { commit: "d".repeat(40), branch: "main", upstream: "origin/main" }, plan: { operation: "artists-rename", operationId, sourceContentId: "a", destinationContentId: "b", repositoryBranch: "main", repositoryUpstream: "origin/main", sourceFile: { file: "old" } } } as any;
    await fs.writeFile(file, JSON.stringify(record));
    const result = await finalizePublishedRename(
      { operationId, directory, file, record }, undefined,
      async () => { throw new Error("injected published write failure"); },
    );
    assert.equal(result.cleaned, false);
    assert.equal(await findRenameEvidence(repository, "artists", "b"), undefined);
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).state, "committed-push-failed");
  } finally { await fs.rm(repository, { recursive: true, force: true }); }
});

test("malformed operation evidence fails closed without cleanup", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  try {
    const directory = path.join(
      repository,
      ".kiki-editor/content-lifecycle/operations/77777777-7777-4777-8777-777777777777",
    );
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "operation.json"), "{broken");
    await assert.rejects(findRenameEvidence(repository, "artists", "b"), /malformed/);
    assert.ok(await fs.lstat(directory));
  } finally {
    await fs.rm(repository, { recursive: true, force: true });
  }
});

test("retry rejects an unrelated later HEAD before push", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  try {
    await execFile("git", ["init", "-b", "main"], { cwd: repository });
    await execFile("git", ["config", "user.name", "Editor Test"], { cwd: repository });
    await execFile("git", ["config", "user.email", "editor@example.test"], { cwd: repository });
    await fs.writeFile(path.join(repository, "initial.txt"), "initial\n");
    await execFile("git", ["add", "."], { cwd: repository });
    await execFile("git", ["commit", "-m", "Initial"], { cwd: repository });
    const recorded = (await execFile("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" })).stdout.trim();
    await execFile("git", ["commit", "--allow-empty", "-m", "Unrelated later commit"], { cwd: repository });
    const operationId = "88888888-8888-4888-8888-888888888888";
    const directory = path.join(repository, ".kiki-editor/content-lifecycle/operations", operationId);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, "operation.json");
    const record = {
      state: "committed-push-failed",
      operation: "artists-rename",
      publication: { commit: recorded, branch: "main", upstream: "origin/main" },
      plan: {
        operation: "artists-rename",
        operationId,
        sourceContentId: "a",
        destinationContentId: "b",
        repositoryBranch: "main",
        repositoryUpstream: "origin/main",
        sourceFile: { file: "initial.txt" },
      },
    } as any;
    let pushed = false;
    await assert.rejects(
      publishRecordedRenameCommit(
        { operationId, directory, file, record },
        repository,
        "main",
        "origin/main",
        async () => { pushed = true; },
      ),
      /does not match HEAD/,
    );
    assert.equal(pushed, false);
    assert.ok(await fs.lstat(directory));
  } finally {
    await fs.rm(repository, { recursive: true, force: true });
  }
});

test("retry does not re-push a commit already confirmed at the remote", async () => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  try {
    await execFile("git", ["init", "-b", "main"], { cwd: repository });
    await execFile("git", ["config", "user.name", "Editor Test"], { cwd: repository });
    await execFile("git", ["config", "user.email", "editor@example.test"], { cwd: repository });
    await fs.writeFile(path.join(repository, "initial.txt"), "initial\n");
    await execFile("git", ["add", "."], { cwd: repository });
    await execFile("git", ["commit", "-m", "Initial"], { cwd: repository });
    const commit = (await execFile("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" })).stdout.trim();
    const operationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const located = { operationId, directory: "", file: "", record: { state: "committed-push-failed", publication: { commit, branch: "main", upstream: "origin/main" } } } as any;
    let pushes = 0;
    assert.equal(await publishRecordedRenameCommit(
      located, repository, "main", "origin/main", async () => { pushes += 1; }, async () => true,
    ), commit);
    assert.equal(pushes, 0);
  } finally { await fs.rm(repository, { recursive: true, force: true }); }
});

async function publicationFixture(state = "committed-push-failed", commit = "e".repeat(40)) {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "rename-evidence-"));
  await execFile("git", ["init", "-b", "main"], { cwd: repository });
  await execFile("git", ["config", "user.name", "Editor Test"], { cwd: repository });
  await execFile("git", ["config", "user.email", "editor@example.test"], { cwd: repository });
  await fs.writeFile(path.join(repository, "initial.txt"), "initial\n");
  await execFile("git", ["add", "."], { cwd: repository });
  await execFile("git", ["commit", "-m", "Initial"], { cwd: repository });
  const head = (await execFile("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" })).stdout.trim();
  const operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const directory = path.join(repository, ".kiki-editor/content-lifecycle/operations", operationId);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, "operation.json");
  const record = {
    state, operation: "artists-rename",
    publication: { commit: commit === "HEAD" ? head : commit, branch: "main", upstream: "origin/main" },
    plan: { operation: "artists-rename", operationId, sourceContentId: "a", destinationContentId: "b", repositoryBranch: "main", repositoryUpstream: "origin/main", sourceFile: { file: "initial.txt" } },
  } as any;
  await fs.writeFile(file, JSON.stringify(record));
  return { repository, operationId, directory, file, record, head };
}

test("marker and primary commit contradiction fails closed", async () => {
  const fixture = await publicationFixture("committed-push-failed", "a".repeat(40));
  try {
    await fs.writeFile(path.join(fixture.directory, "rename-publication.json"), JSON.stringify({
      version: 1, operationId: fixture.operationId, operation: "artists-rename",
      sourceContentId: "a", destinationContentId: "b", phase: "published-confirmed",
      branch: "main", upstream: "origin/main", commit: "b".repeat(40),
    }));
    await assert.rejects(findRenameEvidence(fixture.repository, "artists", "b"), /contradict/);
  } finally { await fs.rm(fixture.repository, { recursive: true, force: true }); }
});

test("push-intent is durable before push and definitive failure restores committed retry", async () => {
  const fixture = await publicationFixture("committed-push-failed", "HEAD");
  try {
    let observedPhase = "";
    await assert.rejects(publishRecordedRenameCommit(
      fixture, fixture.repository, "main", "origin/main",
      async () => {
        observedPhase = JSON.parse(await fs.readFile(path.join(fixture.directory, "rename-publication.json"), "utf8")).phase;
        throw new Error("definitive push failure");
      },
      async () => false,
    ), /definitive push failure/);
    assert.equal(observedPhase, "push-intent");
    assert.equal(JSON.parse(await fs.readFile(path.join(fixture.directory, "rename-publication.json"), "utf8")).phase, "committed");
    assert.equal((await findRenameEvidence(fixture.repository, "artists", "b"))?.record.state, "committed-push-failed");
  } finally { await fs.rm(fixture.repository, { recursive: true, force: true }); }
});

test("unresolved push-intent never pushes when remote does not contain the commit", async () => {
  const fixture = await publicationFixture("committed-push-failed", "HEAD");
  try {
    await fs.writeFile(path.join(fixture.directory, "rename-publication.json"), JSON.stringify({
      version: 1, operationId: fixture.operationId, operation: "artists-rename",
      sourceContentId: "a", destinationContentId: "b", phase: "push-intent",
      branch: "main", upstream: "origin/main", commit: fixture.head,
    }));
    const located = await findRenameEvidence(fixture.repository, "artists", "b");
    let pushes = 0;
    await assert.rejects(publishRecordedRenameCommit(
      located!, fixture.repository, "main", "origin/main",
      async () => { pushes += 1; }, async () => false,
    ), /outcome is uncertain/);
    assert.equal(pushes, 0);
    assert.equal(JSON.parse(await fs.readFile(path.join(fixture.directory, "rename-publication.json"), "utf8")).phase, "push-intent");
  } finally { await fs.rm(fixture.repository, { recursive: true, force: true }); }
});

test("push-intent write failure prevents the push callback", async () => {
  const fixture = await publicationFixture("committed-push-failed", "HEAD");
  try {
    let pushes = 0;
    await assert.rejects(publishRecordedRenameCommit(
      fixture, fixture.repository, "main", "origin/main",
      async () => { pushes += 1; }, async () => false,
      async () => { throw new Error("injected push-intent write failure"); },
    ), /push-intent write failure/);
    assert.equal(pushes, 0);
    assert.equal(await fs.lstat(path.join(fixture.directory, "rename-publication.json")).catch(() => undefined), undefined);
  } finally { await fs.rm(fixture.repository, { recursive: true, force: true }); }
});

test("post-push marker and primary write failure leaves the prior push-intent durable", async () => {
  const fixture = await publicationFixture("push-outcome-uncertain", "HEAD");
  try {
    const marker = { version: 1, operationId: fixture.operationId, operation: "artists-rename", sourceContentId: "a", destinationContentId: "b", phase: "push-intent", branch: "main", upstream: "origin/main", commit: fixture.head };
    await fs.writeFile(path.join(fixture.directory, "rename-publication.json"), JSON.stringify(marker));
    await assert.rejects(finalizePublishedRename(
      fixture, undefined,
      async () => { throw new Error("injected primary failure"); },
      async () => { throw new Error("injected marker failure"); },
    ), /could not be durably finalized/);
    assert.equal(JSON.parse(await fs.readFile(path.join(fixture.directory, "rename-publication.json"), "utf8")).phase, "push-intent");
    const located = await findRenameEvidence(fixture.repository, "artists", "b");
    assert.equal(located?.record.state, "push-outcome-uncertain");
  } finally { await fs.rm(fixture.repository, { recursive: true, force: true }); }
});
