import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeJournalDelete } from "./journal-delete.ts";
import {
  assertJournalMutationAdmitted,
  detectJournalManualRecovery,
  JournalManualRecoveryError,
  readJournalManualRecoveryStatus,
} from "./journal-manual-recovery.ts";
import { publishSavedJournalEntry } from "./journal-publish.ts";
import { executeJournalRename } from "./journal-rename.ts";
import { saveJournalEditorDraft } from "./journal-save.ts";

const files = ["index.yaml", "ja.md", "en.md"] as const;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-recovery-"));
  const journalRoot = path.join(root, "src/content/journal");
  for (const contentId of ["affected", "unaffected"])
    await fs.mkdir(path.join(journalRoot, contentId), { recursive: true });
  for (const name of files) {
    await fs.writeFile(path.join(journalRoot, "affected", name), `${name}\n`);
    await fs.writeFile(path.join(journalRoot, "unaffected", name), `${name}\n`);
  }
  return { root, journalRoot };
}

async function installRecoveryPair(
  journalRoot: string,
  contentId = "affected",
) {
  const identity = randomUUID();
  const prefix = `.journal-save-${identity}`;
  const directory = path.join(journalRoot, contentId);
  const stage = path.join(directory, `${prefix}-stage`);
  const backup = path.join(directory, `${prefix}-backup`);
  await fs.mkdir(stage);
  await fs.mkdir(backup);
  await fs.writeFile(path.join(stage, "en.md"), "staged\n");
  for (const name of files)
    await fs.copyFile(path.join(directory, name), path.join(backup, name));
  return { identity, prefix, stage, backup };
}

test("Journal recovery detection requires one exact safe transaction pair", async (t) => {
  const { root, journalRoot } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(journalRoot, "affected");

  await fs.mkdir(path.join(directory, `.journal-save-${randomUUID()}-backup`));
  await fs.mkdir(path.join(directory, ".journal-save-not-a-uuid-stage"));
  assert.equal(
    await detectJournalManualRecovery("affected", journalRoot),
    null,
  );

  const recovery = await installRecoveryPair(journalRoot);
  assert.deepEqual(await detectJournalManualRecovery("affected", journalRoot), {
    contentId: "affected",
    transaction: recovery.identity,
    recoveryReference: `src/content/journal/affected/${recovery.prefix}`,
    evidenceIntegrity: "complete",
  });
  assert.equal(
    await detectJournalManualRecovery("unaffected", journalRoot),
    null,
  );
});

test("an exact but incomplete recovery pair still fails closed", async (t) => {
  const { root, journalRoot } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const recovery = await installRecoveryPair(journalRoot);
  await fs.rm(path.join(recovery.backup, "ja.md"));

  assert.equal(
    (await detectJournalManualRecovery("affected", journalRoot))
      ?.evidenceIntegrity,
    "incomplete-or-unsafe",
  );
  await assert.rejects(
    assertJournalMutationAdmitted("affected", journalRoot),
    JournalManualRecoveryError,
  );
});

test("Journal recovery status is minimal, path-safe, and read-only", async (t) => {
  const { root, journalRoot } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await fs.readdir(path.join(journalRoot, "affected"));

  assert.deepEqual(
    await readJournalManualRecoveryStatus("affected", journalRoot),
    { state: "normal" },
  );
  const recovery = await installRecoveryPair(journalRoot);
  const status = await readJournalManualRecoveryStatus("affected", journalRoot);
  assert.deepEqual(status, {
    state: "manual-recovery-required",
    recoveryReference: `src/content/journal/affected/${recovery.prefix}`,
  });
  assert.equal(JSON.stringify(status).includes(root), false);
  assert.deepEqual(
    (await fs.readdir(path.join(journalRoot, "affected"))).sort(),
    [...before, `${recovery.prefix}-backup`, `${recovery.prefix}-stage`].sort(),
  );
  assert.deepEqual(await fs.readdir(recovery.stage), ["en.md"]);
  assert.deepEqual(
    (await fs.readdir(recovery.backup)).sort(),
    [...files].sort(),
  );
});

test("durable Journal recovery evidence rejects every dangerous mutation after a fresh invocation", async (t) => {
  const { root, journalRoot } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const recovery = await installRecoveryPair(journalRoot);
  const before = await Promise.all(
    files.map((name) => fs.readFile(path.join(journalRoot, "affected", name))),
  );
  const expected = (error: unknown) =>
    error instanceof JournalManualRecoveryError &&
    error.code === "journal-manual-recovery-required" &&
    !error.message.includes(root);

  await assert.rejects(
    saveJournalEditorDraft(
      { contentId: "affected" } as never,
      { contentId: "affected" } as never,
      journalRoot,
    ),
    expected,
  );
  await assert.rejects(
    publishSavedJournalEntry(
      { contentId: "affected" } as never,
      false,
      root,
      journalRoot,
    ),
    expected,
  );
  await assert.rejects(
    executeJournalRename({ sourceContentId: "affected" } as never, root),
    expected,
  );
  await assert.rejects(
    executeJournalDelete({ contentId: "affected" } as never, root),
    expected,
  );

  await assertJournalMutationAdmitted("unaffected", journalRoot);
  await assert.rejects(
    assertJournalMutationAdmitted("affected", journalRoot),
    expected,
  );
  assert.deepEqual(
    await Promise.all(
      files.map((name) =>
        fs.readFile(path.join(journalRoot, "affected", name)),
      ),
    ),
    before,
  );
  assert.deepEqual(
    (await fs.readdir(recovery.backup)).sort(),
    [...files].sort(),
  );
  assert.deepEqual(await fs.readdir(recovery.stage), ["en.md"]);

  await fs.rm(recovery.stage, { recursive: true });
  await fs.rm(recovery.backup, { recursive: true });
  await assertJournalMutationAdmitted("affected", journalRoot);
});
