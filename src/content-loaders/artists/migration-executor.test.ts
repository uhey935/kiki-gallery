import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ArtistMigrationManualRecoveryError,
  executeLegacyArtistMigration,
  FROZEN_ARTISTS_MIGRATION_MANIFEST_SHA256,
  type ArtistMigrationRecoveryEvidence,
} from "./migration-executor.ts";
import {
  ARTIST_MIGRATION_INVENTORY,
  artistMigrationSha256,
  type LegacyArtistMigrationManifest,
} from "./migration-manifest.ts";

const frozenManifestPath = path.resolve(
  "docs/architecture/artists-migration-manifest-2026-08-11.json",
);

async function frozenManifest(): Promise<LegacyArtistMigrationManifest> {
  return JSON.parse(await fs.readFile(frozenManifestPath, "utf8"));
}

async function fixture(t: test.TestContext) {
  const manifest = await frozenManifest();
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "artists-migration-executor-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const entry of manifest.entries)
    await fs.writeFile(
      path.join(root, `${entry.contentId}.md`),
      Buffer.from(entry.rollback.originalBase64, "base64"),
    );
  return { manifest, root };
}

async function rootSnapshot(root: string) {
  const snapshot = new Map<string, Buffer>();
  for (const contentId of ARTIST_MIGRATION_INVENTORY)
    snapshot.set(
      contentId,
      await fs.readFile(path.join(root, `${contentId}.md`)),
    );
  return snapshot;
}

async function assertRolledBack(root: string, before: Map<string, Buffer>) {
  for (const contentId of ARTIST_MIGRATION_INVENTORY) {
    assert.deepEqual(
      await fs.readFile(path.join(root, `${contentId}.md`)),
      before.get(contentId),
    );
    await assert.rejects(fs.access(path.join(root, contentId)));
  }
  assert.equal(
    (await fs.readdir(root)).some((name) =>
      name.startsWith(".artists-migration-stage-"),
    ),
    false,
  );
}

test("successful dry-run performs every preflight without filesystem mutation", async (t) => {
  const { manifest, root } = await fixture(t);
  const beforeNames = await fs.readdir(root);
  const before = await rootSnapshot(root);

  const result = await executeLegacyArtistMigration(manifest, {
    rootOverride: root,
    dryRun: true,
  });

  assert.equal(result.mode, "dry-run");
  assert.equal(result.transaction, "all-five-global-rollback");
  assert.deepEqual(result.contentIds, ARTIST_MIGRATION_INVENTORY);
  assert.deepEqual(await fs.readdir(root), beforeNames);
  for (const [contentId, bytes] of before)
    assert.deepEqual(
      await fs.readFile(path.join(root, `${contentId}.md`)),
      bytes,
    );
});

test("successful isolated migration installs the exact five-unit inventory", async (t) => {
  const { manifest, root } = await fixture(t);

  const result = await executeLegacyArtistMigration(manifest, {
    rootOverride: root,
  });

  assert.equal(result.mode, "executed");
  assert.deepEqual(result.contentIds, ARTIST_MIGRATION_INVENTORY);
  assert.equal(result.createdDirectories.length, 5);
  assert.equal(result.removedSources.length, 5);
  assert.deepEqual((await fs.readdir(root)).sort(), [
    ...ARTIST_MIGRATION_INVENTORY,
  ]);
  for (const entry of manifest.entries) {
    await assert.rejects(fs.access(path.join(root, `${entry.contentId}.md`)));
    const directory = path.join(root, entry.contentId);
    assert.deepEqual((await fs.readdir(directory)).sort(), [
      "en.md",
      "index.yaml",
      "ja.md",
    ]);
    for (const [key, filename] of [
      ["shared", "index.yaml"],
      ["ja", "ja.md"],
      ["en", "en.md"],
    ] as const) {
      const bytes = await fs.readFile(path.join(directory, filename));
      assert.equal(bytes.byteLength, entry.generated[key].byteLength);
      assert.equal(artistMigrationSha256(bytes), entry.generated[key].sha256);
    }
    assert.match(
      await fs.readFile(path.join(directory, "en.md"), "utf8"),
      /__TODO_EN_SHORT_BIO__/,
    );
  }
});

test("source drift and unexpected inventory are rejected before staging", async (t) => {
  const drift = await fixture(t);
  await fs.appendFile(path.join(drift.root, "alana-wilson.md"), "drift\n");
  await assert.rejects(
    executeLegacyArtistMigration(drift.manifest, {
      rootOverride: drift.root,
    }),
    /source drift detected/,
  );
  assert.equal(
    (await fs.readdir(drift.root)).some((name) =>
      name.startsWith(".artists-migration-stage-"),
    ),
    false,
  );

  const inventory = await fixture(t);
  await fs.writeFile(path.join(inventory.root, "unexpected.md"), "---\n---\n");
  await assert.rejects(
    executeLegacyArtistMigration(inventory.manifest, {
      rootOverride: inventory.root,
    }),
    /Unexpected Artists inventory/,
  );
});

test("target directory and symlink collisions fail closed", async (t) => {
  const directory = await fixture(t);
  await fs.mkdir(path.join(directory.root, "alana-wilson"));
  await assert.rejects(
    executeLegacyArtistMigration(directory.manifest, {
      rootOverride: directory.root,
    }),
    /target collision or unsafe target/,
  );

  const symlink = await fixture(t);
  await fs.symlink(
    path.join(symlink.root, "alana-wilson.md"),
    path.join(symlink.root, "alana-wilson"),
  );
  await assert.rejects(
    executeLegacyArtistMigration(symlink.manifest, {
      rootOverride: symlink.root,
    }),
    /target collision or unsafe target/,
  );
});

test("non-regular and symlinked source paths are rejected", async (t) => {
  const symlink = await fixture(t);
  const source = path.join(symlink.root, "alana-wilson.md");
  const external = path.join(symlink.root, "external-source");
  await fs.rename(source, external);
  await fs.symlink(external, source);
  await assert.rejects(
    executeLegacyArtistMigration(symlink.manifest, {
      rootOverride: symlink.root,
    }),
    /source is not a regular file/,
  );

  const directory = await fixture(t);
  const directorySource = path.join(directory.root, "alana-wilson.md");
  await fs.unlink(directorySource);
  await fs.mkdir(directorySource);
  await assert.rejects(
    executeLegacyArtistMigration(directory.manifest, {
      rootOverride: directory.root,
    }),
    /source is not a regular file/,
  );
});

test("staged write failure leaves all original bytes and no targets", async (t) => {
  const { manifest, root } = await fixture(t);
  const before = await rootSnapshot(root);
  await assert.rejects(
    executeLegacyArtistMigration(manifest, {
      rootOverride: root,
      hooks: {
        beforeStagedWrite(contentId, filename) {
          if (contentId === "alana-wilson" && filename === "ja.md")
            throw new Error("injected staged write failure");
        },
      },
    }),
    /injected staged write failure/,
  );
  await assertRolledBack(root, before);
});

test("post-install reread failure rolls back every promoted directory", async (t) => {
  const { manifest, root } = await fixture(t);
  const before = await rootSnapshot(root);
  await assert.rejects(
    executeLegacyArtistMigration(manifest, {
      rootOverride: root,
      hooks: {
        async afterDirectoryInstalled(contentId, directory) {
          if (contentId === "alana-wilson")
            await fs.appendFile(
              path.join(directory, "index.yaml"),
              "drift: true\n",
            );
        },
      },
    }),
    /written file reread mismatch/,
  );
  await assertRolledBack(root, before);
});

test("source removal failure restores removed sources and all targets", async (t) => {
  const { manifest, root } = await fixture(t);
  const before = await rootSnapshot(root);
  await assert.rejects(
    executeLegacyArtistMigration(manifest, {
      rootOverride: root,
      hooks: {
        beforeSourceRemoval(contentId) {
          if (contentId === "keisuke-matsuda")
            throw new Error("injected source removal failure");
        },
      },
    }),
    /injected source removal failure/,
  );
  await assertRolledBack(root, before);
});

test("global rollback succeeds after partial promotion", async (t) => {
  const { manifest, root } = await fixture(t);
  const before = await rootSnapshot(root);
  await assert.rejects(
    executeLegacyArtistMigration(manifest, {
      rootOverride: root,
      hooks: {
        afterDirectoryInstalled(contentId) {
          if (contentId === "reiko-kinoshita")
            throw new Error("stop after partial promotion");
        },
      },
    }),
    /stop after partial promotion/,
  );
  await assertRolledBack(root, before);
});

test("rollback failure preserves staging and manual recovery evidence", async (t) => {
  const { manifest, root } = await fixture(t);
  let thrown: unknown;
  try {
    await executeLegacyArtistMigration(manifest, {
      rootOverride: root,
      hooks: {
        afterDirectoryInstalled(contentId) {
          if (contentId === "alana-wilson")
            throw new Error("injected transaction failure");
        },
        beforeRollbackDirectoryRemoval(contentId) {
          if (contentId === "alana-wilson")
            throw new Error("injected rollback failure");
        },
      },
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ArtistMigrationManualRecoveryError);
  const evidencePath = thrown.evidencePath;
  const evidence = JSON.parse(
    await fs.readFile(evidencePath, "utf8"),
  ) as ArtistMigrationRecoveryEvidence;
  assert.equal(evidence.status, "manual-recovery-required");
  assert.equal(
    evidence.manifestSha256,
    FROZEN_ARTISTS_MIGRATION_MANIFEST_SHA256,
  );
  assert.match(evidence.originalError, /injected transaction failure/);
  assert.ok(
    evidence.rollbackErrors.some((message) =>
      message.includes("injected rollback failure"),
    ),
  );
  assert.equal(evidence.recovery.length, 5);
  assert.equal((await fs.stat(evidence.stagingRoot)).isDirectory(), true);
  assert.equal(
    (await fs.stat(path.join(root, "alana-wilson"))).isDirectory(),
    true,
  );
});

test("frozen manifest is the only accepted migration input", async (t) => {
  const { manifest, root } = await fixture(t);
  manifest.entries[0].generated.en.content += "tampered";
  await assert.rejects(
    executeLegacyArtistMigration(manifest, {
      rootOverride: root,
      dryRun: true,
    }),
    /not the frozen manifest/,
  );
});
