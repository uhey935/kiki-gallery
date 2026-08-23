import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HeroAssetPublishEvidenceError,
  HeroAssetPublishEvidenceStore,
  parseHeroAssetPublishEvidence,
  type HeroAssetPublishEvidenceV1,
} from "./hero-asset-publish-evidence.ts";

const evidence = (): HeroAssetPublishEvidenceV1 => ({
  version: 1,
  state: "pending",
  operation: "hero-asset-save",
  collection: "artists",
  contentId: "test-artist",
  content: [
    {
      path: "src/content/artists/test-artist/index.yaml",
      sha256: "a".repeat(64),
      byteSize: 1,
    },
  ],
  assets: [
    {
      src: "/images/artists/test-artist.png",
      path: "public/images/artists/test-artist.png",
      sha256: "b".repeat(64),
      byteSize: 2,
      format: "png",
      mime: "image/png",
      width: 1,
      height: 1,
    },
  ],
  createdAt: "2026-08-23T00:00:00.000Z",
});

test("Hero Publish evidence store atomically round-trips, replaces, and deletes v1", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hero-publish-evidence-"),
  );
  try {
    const store = new HeroAssetPublishEvidenceStore(root);
    await store.write(evidence());
    assert.deepEqual(await store.read("artists", "test-artist"), evidence());
    const failed = {
      ...evidence(),
      state: "committed-push-failed" as const,
      commit: "c".repeat(64),
    };
    await store.write(failed);
    assert.deepEqual(await store.read("artists", "test-artist"), failed);
    assert.deepEqual(
      (
        await fs.readdir(
          path.join(root, ".kiki-editor/publish-evidence/hero-assets/artists"),
        )
      ).filter((name) => name.endsWith(".tmp")),
      [],
    );
    await store.delete("artists", "test-artist");
    assert.equal(await store.read("artists", "test-artist"), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Hero Publish evidence strict parsing and filesystem access fail closed", async () => {
  assert.throws(
    () => parseHeroAssetPublishEvidence({ ...evidence(), extra: true }),
    HeroAssetPublishEvidenceError,
  );
  assert.throws(
    () =>
      parseHeroAssetPublishEvidence({
        ...evidence(),
        assets: [{ ...evidence().assets[0], mime: "image/jpeg" }],
      }),
    HeroAssetPublishEvidenceError,
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hero-publish-unsafe-"));
  try {
    const directory = path.join(
      root,
      ".kiki-editor/publish-evidence/hero-assets/artists",
    );
    await fs.mkdir(directory, { recursive: true });
    await fs.symlink(
      path.join(root, "target"),
      path.join(directory, "test-artist.v1.json"),
    );
    await assert.rejects(
      new HeroAssetPublishEvidenceStore(root).read("artists", "test-artist"),
      HeroAssetPublishEvidenceError,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
