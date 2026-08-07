import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addExistingWorksAsset,
  addTemporaryWorksAsset,
  createWorksAssetDraftState,
} from "./works-asset-draft.ts";
import {
  TemporaryWorksAssetStore,
  TemporaryWorksAssetStoreError,
} from "./works-asset-store.ts";
import { admitWorksAssetUpload } from "./works-assets.ts";
import { uploadTemporaryWorksAsset } from "./works-asset-upload.ts";
import { createWorksEditorDraft } from "./works-draft-state.ts";
import {
  createWorksPreviewModel,
  temporaryWorksAssetPreviewUrl,
} from "./works-preview.ts";
import {
  saveWorksEditorDraftWithAssets,
  WorksSaveError,
} from "./works-save.ts";
import { readWorksEditorEntry } from "./works-state.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const source = `---
title: Test Work
artist: test-artist
images:
  - src: /images/works/existing.png
    alt: Existing
year: 2026
inquiry:
  type: inquiry
---
Body
`;

async function saveFixture(now: () => number = Date.now, ttlMs = 10_000) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "works-asset-save-"));
  const worksRoot = path.join(fixtureRoot, "works");
  const assetRoot = path.join(fixtureRoot, "assets");
  const storeParent = path.join(fixtureRoot, "store");
  await Promise.all([mkdir(worksRoot), mkdir(assetRoot), mkdir(storeParent)]);
  await writeFile(path.join(worksRoot, "test-work.md"), source);
  await writeFile(path.join(assetRoot, "existing.png"), png);
  const store = await TemporaryWorksAssetStore.create({
    parentDirectory: storeParent,
    now,
    ttlMs,
  });
  const baseline = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", worksRoot),
  );
  assert.ok(baseline);
  return { fixtureRoot, worksRoot, assetRoot, store, baseline };
}

async function register(
  store: TemporaryWorksAssetStore,
  filename: string,
  bytes: Uint8Array = png,
) {
  const candidate = { filename, declaredMime: "image/png", bytes };
  const admission = admitWorksAssetUpload(candidate);
  assert.equal(admission.accepted, true);
  return store.register("test-work", "workspace-1", candidate, admission);
}

test("Save materializes one temporary asset, canonicalizes Markdown, and releases the token", async () => {
  const fixture = await saveFixture();
  const pending = await uploadTemporaryWorksAsset({
    contentId: "test-work",
    workspaceId: "workspace-1",
    candidate: {
      filename: "test-work-detail.png",
      declaredMime: "image/png",
      bytes: png,
    },
    store: fixture.store,
    contentExists: () => true,
  });
  const assets = addTemporaryWorksAsset(
    createWorksAssetDraftState(
      "test-work",
      "workspace-1",
      fixture.baseline.data.images,
    ),
    { token: pending.token, alt: "New detail" },
  );
  assert.equal(
    createWorksPreviewModel(fixture.baseline, assets).data.images[1].src,
    temporaryWorksAssetPreviewUrl(pending.token, "test-work", "workspace-1"),
  );
  const result = await saveWorksEditorDraftWithAssets(
    structuredClone(fixture.baseline),
    fixture.baseline,
    { assetDraft: assets, store: fixture.store, assetRoot: fixture.assetRoot },
    fixture.worksRoot,
  );

  assert.deepEqual(
    await readFile(path.join(fixture.assetRoot, "test-work-detail.png")),
    png,
  );
  assert.deepEqual(result.draft.data.images, [
    { src: "/images/works/existing.png", alt: "Existing" },
    { src: "/images/works/test-work-detail.png", alt: "New detail" },
  ]);
  assert.equal(result.assetDraft.images[1].kind, "existing");
  assert.match(
    await readFile(path.join(fixture.worksRoot, "test-work.md"), "utf8"),
    /test-work-detail\.png/,
  );
  await assert.rejects(
    fixture.store.read(pending.token, "test-work", "workspace-1"),
    TemporaryWorksAssetStoreError,
  );
  assert.deepEqual(fixture.baseline.data.images, [
    { src: "/images/works/existing.png", alt: "Existing" },
  ]);
  assert.equal(assets.images[1].kind, "temporary");
});

test("Save preserves mixed order and alt while materializing multiple distinct tokens", async () => {
  const fixture = await saveFixture();
  const one = await register(fixture.store, "test-work-one.png");
  const two = await register(fixture.store, "test-work-two.png");
  let assets = createWorksAssetDraftState("test-work", "workspace-1", []);
  assets = addTemporaryWorksAsset(assets, { token: one.token, alt: "One" });
  assets = addExistingWorksAsset(assets, {
    src: "/images/works/existing.png",
    alt: "Existing changed",
  });
  assets = addTemporaryWorksAsset(assets, { token: two.token, alt: "Two" });
  const result = await saveWorksEditorDraftWithAssets(
    structuredClone(fixture.baseline),
    fixture.baseline,
    { assetDraft: assets, store: fixture.store, assetRoot: fixture.assetRoot },
    fixture.worksRoot,
  );
  assert.deepEqual(
    result.draft.data.images.map(({ src, alt }) => ({ src, alt })),
    [
      { src: "/images/works/test-work-one.png", alt: "One" },
      { src: "/images/works/existing.png", alt: "Existing changed" },
      { src: "/images/works/test-work-two.png", alt: "Two" },
    ],
  );
});

test("filename collision never overwrites an existing canonical asset and retains the token", async () => {
  const fixture = await saveFixture();
  const original = Buffer.from("existing bytes");
  await writeFile(path.join(fixture.assetRoot, "test-work-new.png"), original);
  const pending = await register(fixture.store, "test-work-new.png");
  const assets = addTemporaryWorksAsset(
    createWorksAssetDraftState(
      "test-work",
      "workspace-1",
      fixture.baseline.data.images,
    ),
    { token: pending.token, alt: "New" },
  );
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(fixture.baseline),
      fixture.baseline,
      {
        assetDraft: assets,
        store: fixture.store,
        assetRoot: fixture.assetRoot,
      },
      fixture.worksRoot,
    ),
    (error: unknown) =>
      error instanceof WorksSaveError && error.code === "asset-save-failed",
  );
  assert.deepEqual(
    await readFile(path.join(fixture.assetRoot, "test-work-new.png")),
    original,
  );
  assert.equal(
    await readFile(path.join(fixture.worksRoot, "test-work.md"), "utf8"),
    source,
  );
  await fixture.store.read(pending.token, "test-work", "workspace-1");
});

test("stale Markdown rejects before asset mutation and duplicate tokens are rejected", async () => {
  const fixture = await saveFixture();
  const pending = await register(fixture.store, "test-work-new.png");
  let assets = createWorksAssetDraftState("test-work", "workspace-1", []);
  assets = addTemporaryWorksAsset(assets, { token: pending.token, alt: "One" });
  assets = addTemporaryWorksAsset(assets, { token: pending.token, alt: "Two" });
  const stale = structuredClone(fixture.baseline);
  stale.data.title = "Stale";
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(fixture.baseline),
      stale,
      {
        assetDraft: assets,
        store: fixture.store,
        assetRoot: fixture.assetRoot,
      },
      fixture.worksRoot,
    ),
    (error: unknown) =>
      error instanceof WorksSaveError && error.code === "canonical-mismatch",
  );
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(fixture.baseline),
      fixture.baseline,
      {
        assetDraft: assets,
        store: fixture.store,
        assetRoot: fixture.assetRoot,
      },
      fixture.worksRoot,
    ),
    (error: unknown) =>
      error instanceof WorksSaveError && error.code === "asset-save-failed",
  );
  assert.deepEqual((await readdir(fixture.assetRoot)).sort(), ["existing.png"]);
  await fixture.store.read(pending.token, "test-work", "workspace-1");
});

test("expired and tampered temporary assets are rejected without canonical mutation", async () => {
  let now = 100;
  const expiredFixture = await saveFixture(() => now, 50);
  const expired = await register(expiredFixture.store, "test-work-expired.png");
  now = 150;
  const expiredAssets = addTemporaryWorksAsset(
    createWorksAssetDraftState("test-work", "workspace-1", []),
    { token: expired.token, alt: "Expired" },
  );
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(expiredFixture.baseline),
      expiredFixture.baseline,
      {
        assetDraft: expiredAssets,
        store: expiredFixture.store,
        assetRoot: expiredFixture.assetRoot,
      },
      expiredFixture.worksRoot,
    ),
    (error: unknown) =>
      error instanceof WorksSaveError && error.code === "asset-temp-expired",
  );

  const tamperedFixture = await saveFixture();
  const tampered = await register(
    tamperedFixture.store,
    "test-work-tampered.png",
  );
  const [storeDirectory] = await readdir(
    path.join(tamperedFixture.fixtureRoot, "store"),
  );
  await writeFile(
    path.join(
      tamperedFixture.fixtureRoot,
      "store",
      storeDirectory,
      tampered.token,
    ),
    Buffer.alloc(png.length),
  );
  const tamperedAssets = addTemporaryWorksAsset(
    createWorksAssetDraftState("test-work", "workspace-1", []),
    { token: tampered.token, alt: "Tampered" },
  );
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(tamperedFixture.baseline),
      tamperedFixture.baseline,
      {
        assetDraft: tamperedAssets,
        store: tamperedFixture.store,
        assetRoot: tamperedFixture.assetRoot,
      },
      tamperedFixture.worksRoot,
    ),
    WorksSaveError,
  );
  assert.deepEqual((await readdir(tamperedFixture.assetRoot)).sort(), [
    "existing.png",
  ]);
});

test("existing references are rechecked immediately before asset promotion", async () => {
  const fixture = await saveFixture();
  const pending = await register(fixture.store, "test-work-new.png");
  const assets = addTemporaryWorksAsset(
    createWorksAssetDraftState(
      "test-work",
      "workspace-1",
      fixture.baseline.data.images,
    ),
    { token: pending.token, alt: "New" },
  );
  const native = await import("node:fs/promises");
  const existing = await native.realpath(
    path.join(fixture.assetRoot, "existing.png"),
  );
  let existingChecks = 0;
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(fixture.baseline),
      fixture.baseline,
      {
        assetDraft: assets,
        store: fixture.store,
        assetRoot: fixture.assetRoot,
        assetFileSystem: {
          lstat: (async (target) => {
            if (target === existing && ++existingChecks === 2) {
              await native.rm(existing);
              throw Object.assign(new Error("removed during Save"), {
                code: "ENOENT",
              });
            }
            return native.lstat(target);
          }) as typeof native.lstat,
          realpath: native.realpath,
          open: native.open,
          rm: native.rm,
          readFile: native.readFile,
          link: native.link,
        },
      },
      fixture.worksRoot,
    ),
    (error: unknown) =>
      error instanceof WorksSaveError && error.code === "asset-save-failed",
  );
  assert.equal(
    await readFile(path.join(fixture.worksRoot, "test-work.md"), "utf8"),
    source,
  );
  assert.deepEqual((await readdir(fixture.assetRoot)).sort(), []);
  await fixture.store.read(pending.token, "test-work", "workspace-1");
});

test("Markdown replacement failure rolls back only newly promoted assets and retains tokens", async () => {
  const fixture = await saveFixture();
  const pending = await register(fixture.store, "test-work-new.png");
  const assets = addTemporaryWorksAsset(
    createWorksAssetDraftState(
      "test-work",
      "workspace-1",
      fixture.baseline.data.images,
    ),
    { token: pending.token, alt: "New" },
  );
  const native = await import("node:fs/promises");
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(fixture.baseline),
      fixture.baseline,
      {
        assetDraft: assets,
        store: fixture.store,
        assetRoot: fixture.assetRoot,
      },
      fixture.worksRoot,
      {
        lstat: native.lstat,
        readFile: native.readFile,
        rm: native.rm,
        writeFile: native.writeFile,
        rename: async () => {
          throw new Error("injected Markdown failure");
        },
      },
    ),
    WorksSaveError,
  );
  assert.equal(
    await readFile(path.join(fixture.worksRoot, "test-work.md"), "utf8"),
    source,
  );
  assert.deepEqual((await readdir(fixture.assetRoot)).sort(), ["existing.png"]);
  await fixture.store.read(pending.token, "test-work", "workspace-1");
});

test("partial multi-asset promotion failure cleans every transaction-owned target", async () => {
  const fixture = await saveFixture();
  const one = await register(fixture.store, "test-work-one.png");
  const two = await register(fixture.store, "test-work-two.png");
  let assets = createWorksAssetDraftState("test-work", "workspace-1", [
    { src: "/images/works/existing.png", alt: "Existing" },
  ]);
  assets = addTemporaryWorksAsset(assets, { token: one.token, alt: "One" });
  assets = addTemporaryWorksAsset(assets, { token: two.token, alt: "Two" });
  const native = await import("node:fs/promises");
  let links = 0;
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(fixture.baseline),
      fixture.baseline,
      {
        assetDraft: assets,
        store: fixture.store,
        assetRoot: fixture.assetRoot,
        assetFileSystem: {
          lstat: native.lstat,
          realpath: native.realpath,
          open: native.open,
          rm: native.rm,
          readFile: native.readFile,
          link: async (existingPath, newPath) => {
            links += 1;
            if (links === 2) throw new Error("injected promotion failure");
            await native.link(existingPath, newPath);
          },
        },
      },
      fixture.worksRoot,
    ),
    WorksSaveError,
  );
  assert.equal(
    await readFile(path.join(fixture.worksRoot, "test-work.md"), "utf8"),
    source,
  );
  assert.deepEqual((await readdir(fixture.assetRoot)).sort(), ["existing.png"]);
  await fixture.store.read(one.token, "test-work", "workspace-1");
  await fixture.store.read(two.token, "test-work", "workspace-1");
});

test("unsafe symlink and non-regular canonical targets are rejected", async () => {
  const fixture = await saveFixture();
  const pending = await register(fixture.store, "test-work-new.png");
  const outside = path.join(fixture.fixtureRoot, "outside");
  await writeFile(outside, "outside");
  await symlink(outside, path.join(fixture.assetRoot, "test-work-new.png"));
  const assets = addTemporaryWorksAsset(
    createWorksAssetDraftState("test-work", "workspace-1", []),
    { token: pending.token, alt: "New" },
  );
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(fixture.baseline),
      fixture.baseline,
      {
        assetDraft: assets,
        store: fixture.store,
        assetRoot: fixture.assetRoot,
      },
      fixture.worksRoot,
    ),
    WorksSaveError,
  );
  assert.equal(await readFile(outside, "utf8"), "outside");

  const unsafeRoot = path.join(fixture.fixtureRoot, "unsafe-root");
  await writeFile(unsafeRoot, "not a directory");
  await assert.rejects(
    saveWorksEditorDraftWithAssets(
      structuredClone(fixture.baseline),
      fixture.baseline,
      {
        assetDraft: assets,
        store: fixture.store,
        assetRoot: unsafeRoot,
      },
      fixture.worksRoot,
    ),
    WorksSaveError,
  );
});
