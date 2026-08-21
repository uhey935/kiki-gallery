import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EXHIBITION_MIGRATION_INVENTORY } from "./migration-manifest.ts";
import { executeScheduleNormalization } from "./schedule-normalization-executor.ts";
import {
  createScheduleNormalizationManifest,
  exhibitionScheduleSha256,
} from "./schedule-normalization-manifest.ts";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "exhibition-schedule-v2-"));
  const expected: Record<string, Record<"index.yaml" | "ja.md" | "en.md", string>> = {};
  for (const contentId of EXHIBITION_MIGRATION_INVENTORY) {
    const directory = path.join(root, contentId);
    await mkdir(directory);
    const files = {
      "index.yaml": `artists:\n  - artist-one\nstart_date: 2026-01-01\nend_date: 2026-01-02\nhero:\n  image: /${contentId}.jpg\n  orientation: portrait\n`,
      "ja.md": `---\ntitle: ${contentId}\nvenue: KiKi Gallery\nopening_hours: 13:00-17:00\nclosed_days: 水曜・木曜\nhero_alt: JA alt\n---\nBody ${contentId}\n`,
      "en.md": `---\ntitle: ${contentId}\nhero_alt: EN alt\n---\nEnglish body ${contentId}\n`,
    };
    expected[contentId] = {} as Record<"index.yaml" | "ja.md" | "en.md", string>;
    for (const [name, content] of Object.entries(files) as Array<
      [keyof typeof files, string]
    >) {
      await writeFile(path.join(directory, name), content);
      expected[contentId][name] = exhibitionScheduleSha256(content);
    }
  }
  return { root, expected };
}

test("v2 manifest binds the exact five schedule preimages and byte-preserves EN", async () => {
  const { root, expected } = await fixture();
  try {
    const manifest = await createScheduleNormalizationManifest(root, expected);
    assert.equal(manifest.entries.length, 5);
    for (const entry of manifest.entries) {
      assert.equal(entry.files.length, 3);
      for (const file of entry.files)
        assert.equal(file.preimageSha256, expected[entry.contentId][file.name]);
      const index = entry.files.find((file) => file.name === "index.yaml")!;
      const ja = entry.files.find((file) => file.name === "ja.md")!;
      const en = entry.files.find((file) => file.name === "en.md")!;
      assert.match(index.postimage.toString(), /opens: 13:00/);
      assert.match(index.postimage.toString(), /closed_weekdays:\n  - wed\n  - thu/);
      assert.doesNotMatch(ja.postimage.toString(), /opening_hours|closed_days/);
      assert.equal(
        ja.postimage.toString().split("---\n").at(-1),
        ja.preimage.toString().split("---\n").at(-1),
      );
      assert(en.postimage.equals(en.preimage));
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test("v2 migration installs all postimages and rejects preimage drift", async () => {
  const { root, expected } = await fixture();
  try {
    const manifest = await createScheduleNormalizationManifest(root, expected);
    await writeFile(path.join(root, "unexpected.txt"), "drift");
    await assert.rejects(
      executeScheduleNormalization(manifest, root),
      /inventory drift/,
    );
    await rm(path.join(root, "unexpected.txt"));
    await executeScheduleNormalization(manifest, root, { dryRun: false });
    for (const entry of manifest.entries)
      for (const file of entry.files)
        assert.equal(
          exhibitionScheduleSha256(
            await readFile(path.join(root, entry.contentId, file.name)),
          ),
          file.postimageSha256,
        );
    await assert.rejects(
      createScheduleNormalizationManifest(root),
      /preimage drift|already normalized/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("v2 migration rolls every installed file back after a partial failure", async () => {
  const { root, expected } = await fixture();
  try {
    const manifest = await createScheduleNormalizationManifest(root, expected);
    let installs = 0;
    await assert.rejects(
      executeScheduleNormalization(manifest, root, {
        dryRun: false,
        hooks: {
          beforeInstall() {
            installs += 1;
            if (installs === 8) throw new Error("fixture install failure");
          },
        },
      }),
      /fixture install failure/,
    );
    for (const entry of manifest.entries)
      for (const file of entry.files)
        assert.equal(
          exhibitionScheduleSha256(
            await readFile(path.join(root, entry.contentId, file.name)),
          ),
          file.preimageSha256,
        );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("v2 migration retains recovery evidence when rollback is incomplete", async () => {
  const { root, expected } = await fixture();
  let recovery: string | undefined;
  try {
    const manifest = await createScheduleNormalizationManifest(root, expected);
    let installs = 0;
    let rollbackInjected = false;
    await assert.rejects(
      executeScheduleNormalization(manifest, root, {
        dryRun: false,
        hooks: {
          beforeInstall() {
            installs += 1;
            if (installs === 4) throw new Error("fixture install failure");
          },
          beforeRollback() {
            if (rollbackInjected) return;
            rollbackInjected = true;
            throw new Error("fixture rollback failure");
          },
        },
      }),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /rollback failed; recovery retained/);
        recovery = /retained at (.*?):/.exec(error.message)?.[1];
        return true;
      },
    );
    assert(recovery);
    await access(recovery);
  } finally {
    if (recovery) await rm(recovery, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
