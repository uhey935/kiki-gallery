import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { handleWorksAssetUpload } from "./routes/works-asset-upload.ts";
import { TemporaryWorksAssetStore } from "./works-asset-store.ts";
import {
  WorksAssetUploadError,
  uploadTemporaryWorksAsset,
} from "./works-asset-upload.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function storeFixture() {
  const parentDirectory = await mkdtemp(
    path.join(tmpdir(), "works-upload-test-"),
  );
  return TemporaryWorksAssetStore.create({ parentDirectory });
}

test("accepted upload returns an owned temporary descriptor", async () => {
  const store = await storeFixture();
  const descriptor = await uploadTemporaryWorksAsset({
    contentId: "test-work",
    workspaceId: "workspace-1",
    candidate: {
      filename: "artist-new.png",
      declaredMime: "image/png",
      bytes: png,
    },
    store,
    contentExists: () => true,
  });
  assert.equal(descriptor.contentId, "test-work");
  assert.equal(descriptor.workspaceId, "workspace-1");
  assert.equal(descriptor.proposedUrl, "/images/works/artist-new.png");
  assert.deepEqual(
    (await store.read(descriptor.token, "test-work", "workspace-1")).bytes,
    png,
  );
});

test("upload rejects invalid ownership and transports admission codes", async () => {
  const store = await storeFixture();
  for (const [contentId, workspaceId, contentExists] of [
    ["../work", "workspace-1", true],
    ["test-work", "../workspace", true],
    ["missing-work", "workspace-1", false],
  ] as const) {
    await assert.rejects(
      uploadTemporaryWorksAsset({
        contentId,
        workspaceId,
        candidate: {
          filename: "artist-new.png",
          declaredMime: "image/png",
          bytes: png,
        },
        store,
        contentExists: () => contentExists,
      }),
      (error: unknown) =>
        error instanceof WorksAssetUploadError &&
        error.code === "asset-invalid-request",
    );
  }
  await assert.rejects(
    uploadTemporaryWorksAsset({
      contentId: "test-work",
      workspaceId: "workspace-1",
      candidate: {
        filename: "../unsafe.png",
        declaredMime: "image/png",
        bytes: png,
      },
      store,
      contentExists: () => true,
    }),
    (error: unknown) =>
      error instanceof WorksAssetUploadError &&
      error.code === "asset-unsafe-path",
  );
});

test("multipart handler accepts a file and rejects missing or malformed payloads", async () => {
  const store = await storeFixture();
  const form = new FormData();
  form.set("workspaceId", "workspace-1");
  form.set("file", new File([png], "artist-new.png", { type: "image/png" }));
  const accepted = await handleWorksAssetUpload(
    "test-work",
    new Request("http://editor.test/upload", { method: "POST", body: form }),
    { store, contentExists: () => true, existing: [] },
  );
  assert.equal(accepted.status, 200);
  assert.match((await accepted.json()).asset.token, /^[a-f0-9]{64}$/);

  const missing = await handleWorksAssetUpload(
    "test-work",
    new Request("http://editor.test/upload", {
      method: "POST",
      body: new FormData(),
    }),
    { store, contentExists: () => true, existing: [] },
  );
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, "asset-invalid-request");

  const malformed = await handleWorksAssetUpload(
    "test-work",
    new Request("http://editor.test/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=broken" },
      body: "not multipart",
    }),
    { store, contentExists: () => true, existing: [] },
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "asset-invalid-request");
});

test("multipart handler reports canonical collision without storing", async () => {
  const store = await storeFixture();
  const form = new FormData();
  form.set("workspaceId", "workspace-1");
  form.set("file", new File([png], "artist-new.png", { type: "image/png" }));
  const response = await handleWorksAssetUpload(
    "test-work",
    new Request("http://editor.test/upload", { method: "POST", body: form }),
    {
      store,
      contentExists: () => true,
      existing: [{ filename: "artist-new.png", sha256: "different" }],
    },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "asset-name-conflict");
});
