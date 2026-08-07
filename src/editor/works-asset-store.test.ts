import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addExistingWorksAsset,
  addTemporaryWorksAsset,
  createWorksAssetDraftState,
  removeTemporaryWorksAssetFromDraft,
  reorderWorksAssetDraftImage,
  updateWorksAssetDraftAlt,
} from "./works-asset-draft.ts";
import {
  TemporaryWorksAssetStore,
  TemporaryWorksAssetStoreError,
} from "./works-asset-store.ts";
import { admitWorksAssetUpload } from "./works-assets.ts";
import { serveTemporaryWorksPreviewAsset } from "./routes/works-preview-asset.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const candidate = {
  filename: "artist-new.png",
  declaredMime: "image/png",
  bytes: png,
};

async function storeFixture(ttlMs = 1_000, now: () => number = Date.now) {
  const parentDirectory = await mkdtemp(
    path.join(tmpdir(), "works-asset-store-test-"),
  );
  return TemporaryWorksAssetStore.create({ parentDirectory, ttlMs, now });
}

test("accepted upload stores immutable metadata and bytes outside canonical assets", async () => {
  const store = await storeFixture();
  const admission = admitWorksAssetUpload(candidate);
  assert.equal(admission.accepted, true);
  const metadata = await store.register(
    "test-work",
    "workspace-1",
    candidate,
    admission,
  );
  assert.match(metadata.token, /^[a-f0-9]{64}$/);
  assert.equal(metadata.originalFilename, candidate.filename);
  assert.equal(metadata.mime, "image/png");
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1);
  assert.equal(metadata.height, 1);
  assert.equal(metadata.sha256, createHash("sha256").update(png).digest("hex"));

  const first = await store.read(metadata.token, "test-work", "workspace-1");
  first.bytes[0] = 0;
  first.metadata.originalFilename = "changed.png";
  const second = await store.read(metadata.token, "test-work", "workspace-1");
  assert.deepEqual(second.bytes, png);
  assert.equal(second.metadata.originalFilename, candidate.filename);
});

test("store rejects rejected admission, forged byte metadata, invalid tokens, and ownership mismatch", async () => {
  const store = await storeFixture();
  const rejected = admitWorksAssetUpload({
    ...candidate,
    filename: "../unsafe.png",
  });
  await assert.rejects(
    store.register("test-work", "workspace-1", candidate, rejected),
    (error: unknown) =>
      error instanceof TemporaryWorksAssetStoreError &&
      error.code === "asset-temp-invalid",
  );
  const admission = admitWorksAssetUpload(candidate);
  assert.equal(admission.accepted, true);
  if (!admission.accepted) return;
  await assert.rejects(
    store.register(
      "test-work",
      "workspace-1",
      { ...candidate, bytes: Buffer.from(png).fill(0) },
      admission,
    ),
    TemporaryWorksAssetStoreError,
  );
  const metadata = await store.register(
    "test-work",
    "workspace-1",
    candidate,
    admission,
  );
  for (const [token, contentId, workspaceId] of [
    ["../../etc/passwd", "test-work", "workspace-1"],
    [metadata.token, "other-work", "workspace-1"],
    [metadata.token, "test-work", "workspace-2"],
  ]) {
    await assert.rejects(
      store.read(token, contentId, workspaceId),
      (error: unknown) =>
        error instanceof TemporaryWorksAssetStoreError &&
        error.code === "asset-temp-not-found",
    );
  }
});

test("expiry, sweep, and explicit release remove only temporary records", async () => {
  let now = 100;
  const store = await storeFixture(50, () => now);
  const admission = admitWorksAssetUpload(candidate);
  assert.equal(admission.accepted, true);
  const first = await store.register(
    "test-work",
    "workspace-1",
    candidate,
    admission,
  );
  now = 150;
  await assert.rejects(
    store.read(first.token, "test-work", "workspace-1"),
    (error: unknown) =>
      error instanceof TemporaryWorksAssetStoreError &&
      error.code === "asset-temp-expired",
  );

  now = 200;
  const second = await store.register(
    "test-work",
    "workspace-1",
    candidate,
    admission,
  );
  now = 250;
  assert.equal(await store.sweepExpired(), 1);
  await assert.rejects(
    store.read(second.token, "test-work", "workspace-1"),
    TemporaryWorksAssetStoreError,
  );

  now = 300;
  const third = await store.register(
    "test-work",
    "workspace-1",
    candidate,
    admission,
  );
  await store.release(third.token, "test-work", "workspace-1");
  await assert.rejects(
    store.read(third.token, "test-work", "workspace-1"),
    TemporaryWorksAssetStoreError,
  );
});

test("store refuses a symlink substitution and never reads or removes its target", async () => {
  const parentDirectory = await mkdtemp(
    path.join(tmpdir(), "works-asset-symlink-test-"),
  );
  const store = await TemporaryWorksAssetStore.create({ parentDirectory });
  const admission = admitWorksAssetUpload(candidate);
  assert.equal(admission.accepted, true);
  const metadata = await store.register(
    "test-work",
    "workspace-1",
    candidate,
    admission,
  );
  const outside = path.join(
    await mkdtemp(path.join(tmpdir(), "works-asset-outside-")),
    "outside",
  );
  await writeFile(outside, "outside bytes");
  const [storeDirectory] = await readdir(parentDirectory);
  const storedPath = path.join(parentDirectory, storeDirectory, metadata.token);
  await unlink(storedPath);
  await symlink(outside, storedPath);
  await assert.rejects(
    store.read(metadata.token, "test-work", "workspace-1"),
    (error: unknown) =>
      error instanceof TemporaryWorksAssetStoreError &&
      error.code === "asset-temp-unsafe",
  );
  await assert.rejects(
    store.release(metadata.token, "test-work", "workspace-1"),
    TemporaryWorksAssetStoreError,
  );
  assert.equal(await readFile(outside, "utf8"), "outside bytes");
});

test("temporary preview asset response validates ownership, expiry, integrity, and detected MIME", async () => {
  let now = 100;
  const store = await storeFixture(50, () => now);
  const routeCandidate = { ...candidate, filename: "display-name.png" };
  const admission = admitWorksAssetUpload(routeCandidate);
  assert.equal(admission.accepted, true);
  const metadata = await store.register(
    "test-work",
    "workspace-1",
    routeCandidate,
    admission,
  );
  const params = {
    token: metadata.token,
    contentId: "test-work",
    workspaceId: "workspace-1",
  };
  const valid = await serveTemporaryWorksPreviewAsset(params, store);
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("content-type"), "image/png");
  assert.equal(valid.headers.get("content-length"), String(png.byteLength));
  assert.deepEqual(Buffer.from(await valid.arrayBuffer()), png);

  for (const invalid of [
    { ...params, token: "invalid" },
    { ...params, contentId: "other-work" },
    { ...params, workspaceId: "workspace-2" },
  ]) {
    assert.equal(
      (await serveTemporaryWorksPreviewAsset(invalid, store)).status,
      404,
    );
  }
  now = 150;
  assert.equal(
    (await serveTemporaryWorksPreviewAsset(params, store)).status,
    404,
  );
});

test("temporary preview asset response rejects bytes changed after admission", async () => {
  const parentDirectory = await mkdtemp(
    path.join(tmpdir(), "works-asset-route-tamper-test-"),
  );
  const store = await TemporaryWorksAssetStore.create({ parentDirectory });
  const admission = admitWorksAssetUpload(candidate);
  assert.equal(admission.accepted, true);
  const metadata = await store.register(
    "test-work",
    "workspace-1",
    candidate,
    admission,
  );
  const [storeDirectory] = await readdir(parentDirectory);
  await writeFile(
    path.join(parentDirectory, storeDirectory, metadata.token),
    Buffer.from(png).fill(0),
  );
  assert.equal(
    (
      await serveTemporaryWorksPreviewAsset(
        {
          token: metadata.token,
          contentId: "test-work",
          workspaceId: "workspace-1",
        },
        store,
      )
    ).status,
    404,
  );
});

test("asset Draft operations preserve source state and distinguish existing from temporary", () => {
  const initial = createWorksAssetDraftState("test-work", "workspace-1", [
    { src: "/images/works/one.png", alt: "One" },
  ]);
  const withExisting = addExistingWorksAsset(initial, {
    src: "/images/works/two.png",
    alt: "Two",
  });
  const withTemporary = addTemporaryWorksAsset(withExisting, {
    token: "a".repeat(64),
    alt: "Pending",
  });
  const reordered = reorderWorksAssetDraftImage(withTemporary, 2, 0);
  const updated = updateWorksAssetDraftAlt(reordered, 0, "Updated pending");
  const removed = removeTemporaryWorksAssetFromDraft(updated, "a".repeat(64));

  assert.deepEqual(initial.images, [
    { kind: "existing", src: "/images/works/one.png", alt: "One" },
  ]);
  assert.equal(reordered.images[0].kind, "temporary");
  assert.equal(updated.images[0].alt, "Updated pending");
  assert.deepEqual(
    removed.images.map((image) => image.kind),
    ["existing", "existing"],
  );
  assert.equal(withTemporary.images[2].alt, "Pending");
});
