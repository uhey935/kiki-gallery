import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  ExhibitionsHeroAssetError,
  TemporaryExhibitionsHeroAssetStore,
  inspectExhibitionsHeroCandidate,
} from "./exhibitions-hero-assets.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";
import { planExhibitionsRename, ExhibitionsRenameError } from "./exhibitions-rename.ts";
import { planExhibitionsDelete, ExhibitionsDeleteError } from "./exhibitions-delete.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("Exhibitions Hero derives canonical extension from decoded bytes and enforces ownership", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exhibitions-hero-audit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [format, mime] of [["jpg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"], ["avif", "image/avif"]] as const) {
    const image = sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } });
    const bytes = await (format === "jpg" ? image.jpeg() : format === "png" ? image.png() : format === "webp" ? image.webp() : image.avif()).toBuffer();
    const admitted = await inspectExhibitionsHeroCandidate({ contentId: "audit-exhibition", declaredMime: mime, bytes });
    assert.equal(admitted.proposedSrc, `/images/exhibitions/audit-exhibition.${format}`);
  }
  await assert.rejects(inspectExhibitionsHeroCandidate({ contentId: "../unsafe", declaredMime: "image/png", bytes: png }), (error: unknown) => error instanceof ExhibitionsHeroAssetError && error.code === "asset-invalid-request");
  const store = await TemporaryExhibitionsHeroAssetStore.create({ parentDirectory: root });
  const asset = await store.register({ contentId: "audit-exhibition", workspaceId: "workspace-a", originalFilename: "ignored-name.png", declaredMime: "image/png", bytes: png });
  assert.equal(asset.proposedSrc, "/images/exhibitions/audit-exhibition.png");
  await assert.rejects(store.read(asset.token, "audit-exhibition", "workspace-b"));
  await store.release(asset.token, "audit-exhibition", "workspace-a");
});

test("pending Exhibitions Hero evidence blocks Rename and Delete", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exhibitions-hero-guard-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await new HeroAssetPublishEvidenceStore(root).write({
    version: 1, state: "pending", operation: "hero-asset-save", collection: "exhibitions", contentId: "audit-exhibition",
    content: [{ path: "src/content/exhibitions/audit-exhibition/index.yaml", sha256: "a".repeat(64), byteSize: 1 }],
    assets: [{ src: "/images/exhibitions/audit-exhibition.png", path: "public/images/exhibitions/audit-exhibition.png", sha256: "b".repeat(64), byteSize: 1, format: "png", mime: "image/png", width: 1, height: 1 }],
    createdAt: new Date().toISOString(),
  });
  await assert.rejects(planExhibitionsRename({ repositoryRoot: root, sourceContentId: "audit-exhibition", destinationContentId: "audit-renamed" }), (error: unknown) => error instanceof ExhibitionsRenameError && error.code === "pending-hero-publish-evidence");
  await assert.rejects(planExhibitionsDelete({ repositoryRoot: root, contentId: "audit-exhibition", backupRoot: "/unused" }), (error: unknown) => error instanceof ExhibitionsDeleteError && error.code === "pending-hero-publish-evidence");
});

test("Exhibitions workspace unlocks before rereading upload state and releases superseded candidates", async () => {
  const source = await fs.readFile(path.resolve("src/pages/editor/exhibitions/workspace/[contentId].astro"), "utf8");
  assert.match(source, /pending = null; render\(\); read\(\); renderHero\(\)/);
  assert.match(source, /releaseHero\(pendingHeroCandidate\); pendingHeroCandidate = null/);
  assert.match(source, /void releaseHero\(pendingHeroCandidate\); heroAsset = \{ kind: "empty"/);
});
