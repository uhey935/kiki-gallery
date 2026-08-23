import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  ArtistsHeroAssetError,
  TemporaryArtistsHeroAssetStore,
  inspectArtistsHeroCandidate,
} from "./artists-hero-assets.ts";
import { handleArtistsHeroUpload } from "./routes/artists-hero-asset-upload.ts";
import { createArtistsEditorDraft } from "./artists-draft-state.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
import { saveArtistsEditorDraftWithHero } from "./artists-save.ts";
import { inspectWorksImage } from "./works-asset-inspection.ts";
import {
  ArtistsCreateError,
  createArtistsThreeFileEntryWithHero,
} from "./artists-create.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const otherPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "artists-hero-test-"));
  const contentRoot = path.join(root, "content");
  const assetRoot = path.join(root, "assets");
  const directory = path.join(contentRoot, "test-artist");
  await mkdir(directory, { recursive: true }); await mkdir(assetRoot);
  await writeFile(path.join(directory, "index.yaml"), "sort_name: Test Artist\nhero:\n  image: /images/artists/test-artist.png\nmedium:\n  - Painting\n");
  await writeFile(path.join(directory, "ja.md"), "---\nname: Test\nmedium_label: Painting\nshort_bio: Bio\nhero_alt: JA alt\n---\n");
  await writeFile(path.join(directory, "en.md"), "---\nname: Test\nmedium_label: Painting\nshort_bio: Bio\nhero_alt: EN alt\n---\n");
  await writeFile(path.join(assetRoot, "test-artist.png"), png);
  const store = await TemporaryArtistsHeroAssetStore.create({ parentDirectory: root });
  return { root, contentRoot, assetRoot, store };
}

test("Artists Hero admission derives a slug filename and validates MIME/bytes", async () => {
  const admitted = await inspectArtistsHeroCandidate({ contentId: "test-artist", declaredMime: "image/png", bytes: png });
  assert.equal(admitted.proposedSrc, "/images/artists/test-artist.png");
  assert.equal(admitted.sha256, sha(png));
  await assert.rejects(
    inspectArtistsHeroCandidate({ contentId: "test-artist", declaredMime: "image/jpeg", bytes: png }),
    (error: unknown) => error instanceof ArtistsHeroAssetError && error.code === "asset-type-mismatch",
  );
  await assert.rejects(
    inspectArtistsHeroCandidate({ contentId: "../unsafe", declaredMime: "image/png", bytes: png }),
    (error: unknown) => error instanceof ArtistsHeroAssetError && error.code === "asset-invalid-request",
  );
  await assert.rejects(
    inspectArtistsHeroCandidate({ contentId: "test-artist", declaredMime: "image/png", bytes: Buffer.from("bad") }),
    (error: unknown) => error instanceof ArtistsHeroAssetError && error.code === "asset-decode-failed",
  );
});

test("Artists Hero accepts decoded JPEG, PNG, WebP, and AVIF with matching canonical extensions", async () => {
  for (const [format, mime] of [["jpg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"], ["avif", "image/avif"]] as const) {
    const encoder = sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } });
    const bytes = await (format === "jpg" ? encoder.jpeg() : format === "png" ? encoder.png() : format === "webp" ? encoder.webp() : encoder.avif()).toBuffer();
    const admitted = await inspectArtistsHeroCandidate({ contentId: "test-artist", declaredMime: mime, bytes });
    assert.equal(admitted.proposedSrc, `/images/artists/test-artist.${format}`);
  }
});

test("Artists Hero rejects unsupported and oversized candidates", async () => {
  await assert.rejects(
    inspectArtistsHeroCandidate({ contentId: "test-artist", declaredMime: "image/gif", bytes: Buffer.from("GIF89a malformed") }),
    (error: unknown) => error instanceof ArtistsHeroAssetError && error.code === "asset-decode-failed",
  );
  await assert.rejects(
    inspectArtistsHeroCandidate({ contentId: "test-artist", declaredMime: "image/png", bytes: new Uint8Array(20 * 1024 * 1024 + 1) }),
    (error: unknown) => error instanceof ArtistsHeroAssetError && error.code === "asset-too-large",
  );
});

test("temporary tokens are owner-bound and expiring", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artists-hero-store-"));
  let now = 0;
  const store = await TemporaryArtistsHeroAssetStore.create({ parentDirectory: root, ttlMs: 10, now: () => now });
  const item = await store.register({ contentId: "test-artist", workspaceId: "workspace-1", originalFilename: "anything.png", declaredMime: "image/png", bytes: png });
  await assert.rejects(store.read(item.token, "test-artist", "workspace-2"));
  now = 10;
  await assert.rejects(store.read(item.token, "test-artist", "workspace-1"), (error: unknown) => error instanceof ArtistsHeroAssetError && error.code === "asset-temp-expired");
  await rm(root, { recursive: true });
});

test("upload reuses identical target and stages different bytes without mutation", async () => {
  const value = await fixture();
  try {
    const request = (bytes: Uint8Array) => {
      const form = new FormData(); form.set("workspaceId", "workspace-1");
      const part = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      form.set("file", new File([part], "ignored-name.png", { type: "image/png" }));
      return new Request("http://editor/upload", { method: "POST", body: form });
    };
    const reuse = await handleArtistsHeroUpload("test-artist", request(png), { root: value.assetRoot, store: value.store, contentExists: () => true });
    assert.equal((await reuse.json()).state, "reuse");
    const collision = await handleArtistsHeroUpload("test-artist", request(otherPng), { root: value.assetRoot, store: value.store, contentExists: () => true });
    const result = await collision.json();
    assert.equal(result.state, "replace-confirmation");
    assert.deepEqual(await readFile(path.join(value.assetRoot, "test-artist.png")), png);
    await value.store.release(result.asset.token, "test-artist", "workspace-1");
    assert.deepEqual(await readFile(path.join(value.assetRoot, "test-artist.png")), png);
  } finally { await rm(value.root, { recursive: true }); }
});

test("multipart upload rejects multiple files and an oversized declared body", async () => {
  const value = await fixture();
  try {
    const form = new FormData(); form.set("workspaceId", "workspace-1");
    form.append("file", new File([png], "one.png", { type: "image/png" }));
    form.append("file", new File([png], "two.png", { type: "image/png" }));
    const multiple = await handleArtistsHeroUpload("test-artist", new Request("http://editor/upload", { method: "POST", body: form }), { root: value.assetRoot, store: value.store, contentExists: () => true });
    assert.equal(multiple.status, 400);
    const oversized = await handleArtistsHeroUpload("test-artist", new Request("http://editor/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(21 * 1024 * 1024 + 1024 * 1024) },
      body: "--x--",
    }), { root: value.assetRoot, store: value.store, contentExists: () => true });
    assert.equal(oversized.status, 400);
  } finally { await rm(value.root, { recursive: true }); }
});

test("legacy Artists .png URLs retain their WebP bytes without retroactive extension validation", async () => {
  const expected = {
    "alana-wilson.png": "c0cd658dd22c7f497463736eee1a07f2de44edf6674ceaf3942522078c889163",
    "keisuke-matsuda.png": "2cf0114f2f9e5791fb9c17511d75af2e096bbee78aede18977646a6a306cb122",
    "takeyoshi-mitsui.png": "d68334ad732e0efdbe72bcef410c61625fc1171875ffe074a07e32015d251599",
  } as const;
  for (const [filename, digest] of Object.entries(expected)) {
    const bytes = await readFile(path.resolve("public/images/artists", filename));
    assert.equal(sha(bytes), digest);
    assert.equal(inspectWorksImage(bytes).format, "webp");
  }
});

test("Save commits replacement bytes and content together", async () => {
  const value = await fixture();
  try {
    const baseline = createArtistsEditorDraft(await readArtistsEditorEntry("test-artist", value.contentRoot))!;
    const metadata = await value.store.register({
      contentId: "test-artist", workspaceId: "workspace-1", originalFilename: "original.png", declaredMime: "image/png", bytes: otherPng,
      replaces: { src: "/images/artists/test-artist.png", sha256: sha(png) },
    });
    const draft = structuredClone(baseline); draft.data.name = "Saved Artist";
    const saved = await saveArtistsEditorDraftWithHero(draft, baseline, {
      kind: "temporary", token: metadata.token, workspaceId: "workspace-1", proposedSrc: metadata.proposedSrc,
      sha256: metadata.sha256, replaces: metadata.replaces,
    }, { root: value.contentRoot, assetRoot: value.assetRoot, store: value.store });
    assert.equal(saved.data.name, "Saved Artist");
    assert.deepEqual(await readFile(path.join(value.assetRoot, "test-artist.png")), otherPng);
    await assert.rejects(value.store.read(metadata.token, "test-artist", "workspace-1"));
  } finally { await rm(value.root, { recursive: true }); }
});

test("format change creates the decoded-format URL and preserves the old asset", async () => {
  const value = await fixture();
  try {
    await fs.rename(path.join(value.assetRoot, "test-artist.png"), path.join(value.assetRoot, "legacy.jpg"));
    await writeFile(path.join(value.contentRoot, "test-artist/index.yaml"), "sort_name: Test Artist\nhero:\n  image: /images/artists/legacy.jpg\nmedium:\n  - Painting\n");
    const baseline = createArtistsEditorDraft(await readArtistsEditorEntry("test-artist", value.contentRoot))!;
    const metadata = await value.store.register({ contentId: "test-artist", workspaceId: "workspace-1", originalFilename: "desktop-name.png", declaredMime: "image/png", bytes: otherPng });
    const draft = structuredClone(baseline);
    draft.data.hero.image = metadata.proposedSrc;
    await saveArtistsEditorDraftWithHero(draft, baseline, { kind: "temporary", token: metadata.token, workspaceId: "workspace-1", proposedSrc: metadata.proposedSrc, sha256: metadata.sha256 }, { root: value.contentRoot, assetRoot: value.assetRoot, store: value.store });
    assert.deepEqual(await readFile(path.join(value.assetRoot, "test-artist.png")), otherPng);
    assert.deepEqual(await readFile(path.join(value.assetRoot, "legacy.jpg")), png);
  } finally { await rm(value.root, { recursive: true }); }
});

test("content install failure restores existing Hero bytes", async () => {
  const value = await fixture();
  try {
    const baseline = createArtistsEditorDraft(await readArtistsEditorEntry("test-artist", value.contentRoot))!;
    const metadata = await value.store.register({
      contentId: "test-artist", workspaceId: "workspace-1", originalFilename: "x.png", declaredMime: "image/png", bytes: otherPng,
      replaces: { src: "/images/artists/test-artist.png", sha256: sha(png) },
    });
    const draft = structuredClone(baseline); draft.data.name = "Must Roll Back";
    let failed = false;
    const fileSystem = {
      lstat: fs.lstat.bind(fs), mkdir: fs.mkdir.bind(fs), readFile: fs.readFile.bind(fs), rm: fs.rm.bind(fs), writeFile: fs.writeFile.bind(fs),
      rename: async (...args: Parameters<typeof fs.rename>) => {
        const [from, to] = args;
        if (!failed && String(from).includes("-stage/index.yaml") && String(to).endsWith("/index.yaml")) { failed = true; throw new Error("injected content install failure"); }
        return fs.rename(...args);
      },
    };
    await assert.rejects(saveArtistsEditorDraftWithHero(draft, baseline, {
      kind: "temporary", token: metadata.token, workspaceId: "workspace-1", proposedSrc: metadata.proposedSrc,
      sha256: metadata.sha256, replaces: metadata.replaces,
    }, { root: value.contentRoot, assetRoot: value.assetRoot, store: value.store, fileSystem }));
    assert.deepEqual(await readFile(path.join(value.assetRoot, "test-artist.png")), png);
    assert.match(await readFile(path.join(value.contentRoot, "test-artist/index.yaml"), "utf8"), /sort_name: Test Artist/);
  } finally { await rm(value.root, { recursive: true }); }
});

test("Artists Hero UI exposes thumbnail, path, drop, select, replace, and remove controls", async () => {
  const component = await readFile(path.resolve("src/components/editor/ArtistsDraftForm.astro"), "utf8");
  for (const marker of ["data-artists-hero-thumbnail", "data-artists-hero-canonical-path", "data-artists-hero-drop", "data-artists-hero-select", "data-artists-hero-replace", "data-artists-hero-remove"])
    assert.match(component, new RegExp(marker));
  const workspace = await readFile(path.resolve("src/pages/editor/artists/workspace/[contentId].astro"), "utf8");
  assert.match(workspace, /heroPath\.value = ""/);
  assert.match(workspace, /temporaryArtistsHeroPreviewUrl/);
});

test("Create Hero ownership is isolated from existing workspace ownership", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artists-create-owner-"));
  try {
    const store = await TemporaryArtistsHeroAssetStore.create({
      parentDirectory: root,
    });
    const item = await store.register({
      contentId: "create-workspace-one",
      workspaceId: "workspace-one",
      originalFilename: "x.png",
      declaredMime: "image/png",
      bytes: png,
    });
    await assert.rejects(
      store.read(item.token, "test-artist", "workspace-one"),
    );
    await assert.rejects(
      store.read(item.token, "create-workspace-one", "workspace-two"),
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("Create upload reuses Artists admission and stores bytes under only its Create owner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artists-create-upload-"));
  try {
    const store = await TemporaryArtistsHeroAssetStore.create({
      parentDirectory: root,
    });
    const request = (bytes: Uint8Array, type = "image/png") => {
      const form = new FormData();
      form.set("createWorkspaceId", "create-owner");
      const part = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      form.set("file", new File([part], "desktop-name.png", { type }));
      return new Request("http://editor/upload", {
        method: "POST",
        body: form,
      });
    };
    const accepted = await handleArtistsHeroUpload(undefined, request(png), {
      create: true,
      store,
    });
    assert.equal(accepted.status, 200);
    const result = await accepted.json();
    assert.equal(result.state, "temporary");
    assert.equal(result.asset.format, "png");
    await store.read(result.asset.token, "create-create-owner", "create-owner");
    await assert.rejects(
      store.read(result.asset.token, "create-create-owner", "another-owner"),
    );

    const rejected = await handleArtistsHeroUpload(
      undefined,
      request(Buffer.from("bad")),
      { create: true, store },
    );
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, "asset-decode-failed");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("First Save derives the final target from the current Content ID and releases the token", async () => {
  const value = await fixture();
  try {
    const baseline = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", value.contentRoot),
    )!;
    const workspace = "create-owner-one";
    const metadata = await value.store.register({
      contentId: `create-${workspace}`,
      workspaceId: workspace,
      originalFilename: "desktop.png",
      declaredMime: "image/png",
      bytes: otherPng,
    });
    const draft = structuredClone(baseline);
    draft.contentId = "artist-b";
    draft.data.hero.image = "/images/artists/artist-b.png";
    const saved = await createArtistsThreeFileEntryWithHero(
      draft,
      {
        token: metadata.token,
        createWorkspaceId: workspace,
        sha256: metadata.sha256,
        format: metadata.format,
      },
      {
        root: value.contentRoot,
        assetRoot: value.assetRoot,
        store: value.store,
      },
    );
    assert.equal(saved.contentId, "artist-b");
    assert.deepEqual(
      await readFile(path.join(value.assetRoot, "artist-b.png")),
      otherPng,
    );
    await assert.rejects(readFile(path.join(value.assetRoot, "artist-a.png")));
    await assert.rejects(
      value.store.read(metadata.token, `create-${workspace}`, workspace),
    );
  } finally {
    await rm(value.root, { recursive: true });
  }
});

test("Create reuses identical target and blocks different-byte collision", async () => {
  const value = await fixture();
  try {
    const baseline = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", value.contentRoot),
    )!;
    const create = async (id: string, bytes: Uint8Array, workspace: string) => {
      const metadata = await value.store.register({
        contentId: `create-${workspace}`,
        workspaceId: workspace,
        originalFilename: "x.png",
        declaredMime: "image/png",
        bytes,
      });
      const draft = structuredClone(baseline);
      draft.contentId = id;
      draft.data.hero.image = `/images/artists/${id}.png`;
      return {
        metadata,
        draft,
        input: {
          token: metadata.token,
          createWorkspaceId: workspace,
          sha256: metadata.sha256,
          format: metadata.format,
        },
      };
    };
    await writeFile(path.join(value.assetRoot, "reuse-artist.png"), png);
    const reuse = await create("reuse-artist", png, "reuse-owner");
    await createArtistsThreeFileEntryWithHero(reuse.draft, reuse.input, {
      root: value.contentRoot,
      assetRoot: value.assetRoot,
      store: value.store,
    });
    assert.deepEqual(
      await readFile(path.join(value.assetRoot, "reuse-artist.png")),
      png,
    );

    await writeFile(path.join(value.assetRoot, "blocked-artist.png"), png);
    const blocked = await create("blocked-artist", otherPng, "blocked-owner");
    await assert.rejects(
      createArtistsThreeFileEntryWithHero(blocked.draft, blocked.input, {
        root: value.contentRoot,
        assetRoot: value.assetRoot,
        store: value.store,
      }),
      (error: unknown) =>
        error instanceof ArtistsCreateError &&
        error.code === "asset-name-conflict",
    );
    assert.deepEqual(
      await readFile(path.join(value.assetRoot, "blocked-artist.png")),
      png,
    );
    await value.store.read(
      blocked.metadata.token,
      "create-blocked-owner",
      "blocked-owner",
    );
  } finally {
    await rm(value.root, { recursive: true });
  }
});

test("Create content install failure rolls the newly installed asset back and retains candidate", async () => {
  const value = await fixture();
  try {
    const baseline = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", value.contentRoot),
    )!;
    const workspace = "rollback-owner";
    const metadata = await value.store.register({
      contentId: `create-${workspace}`,
      workspaceId: workspace,
      originalFilename: "x.png",
      declaredMime: "image/png",
      bytes: otherPng,
    });
    const draft = structuredClone(baseline);
    draft.contentId = "rollback-artist";
    draft.data.hero.image = "/images/artists/rollback-artist.png";
    const destination = path.join(value.contentRoot, "rollback-artist");
    let failed = false;
    const fileSystem = {
      ...fs,
      rename: async (...args: Parameters<typeof fs.rename>) => {
        if (!failed && String(args[1]) === destination) {
          failed = true;
          throw new Error("injected content install failure");
        }
        return fs.rename(...args);
      },
    };
    await assert.rejects(
      createArtistsThreeFileEntryWithHero(
        draft,
        {
          token: metadata.token,
          createWorkspaceId: workspace,
          sha256: metadata.sha256,
          format: metadata.format,
        },
        {
          root: value.contentRoot,
          assetRoot: value.assetRoot,
          store: value.store,
          fileSystem,
        },
      ),
    );
    await assert.rejects(
      readFile(path.join(value.assetRoot, "rollback-artist.png")),
    );
    await assert.rejects(fs.lstat(destination));
    await value.store.read(metadata.token, `create-${workspace}`, workspace);
  } finally {
    await rm(value.root, { recursive: true });
  }
});

test("expired Create token and Content ID collision leave canonical assets unchanged", async () => {
  const value = await fixture();
  try {
    const baseline = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", value.contentRoot),
    )!;
    const workspace = "expired-owner";
    let now = 0;
    const expiringRoot = path.join(value.root, "expiring");
    await mkdir(expiringRoot);
    const expiring = await TemporaryArtistsHeroAssetStore.create({
      parentDirectory: expiringRoot,
      ttlMs: 60_000,
      now: () => now,
    });
    const expired = await expiring.register({
      contentId: `create-${workspace}`,
      workspaceId: workspace,
      originalFilename: "x.png",
      declaredMime: "image/png",
      bytes: otherPng,
    });
    const expiredDraft = structuredClone(baseline);
    expiredDraft.contentId = "expired-artist";
    expiredDraft.data.hero.image = "/images/artists/expired-artist.png";
    now = 60_000;
    await assert.rejects(
      createArtistsThreeFileEntryWithHero(
        expiredDraft,
        {
          token: expired.token,
          createWorkspaceId: workspace,
          sha256: expired.sha256,
          format: expired.format,
        },
        {
          root: value.contentRoot,
          assetRoot: value.assetRoot,
          store: expiring,
        },
      ),
      (error: unknown) =>
        error instanceof ArtistsCreateError &&
        error.code === "asset-temp-expired",
    );
    await assert.rejects(
      readFile(path.join(value.assetRoot, "expired-artist.png")),
    );

    const collisionWorkspace = "collision-owner";
    const candidate = await value.store.register({
      contentId: `create-${collisionWorkspace}`,
      workspaceId: collisionWorkspace,
      originalFilename: "x.png",
      declaredMime: "image/png",
      bytes: otherPng,
    });
    const collisionDraft = structuredClone(baseline);
    collisionDraft.contentId = "test-artist";
    collisionDraft.data.hero.image = "/images/artists/test-artist.png";
    await assert.rejects(
      createArtistsThreeFileEntryWithHero(
        collisionDraft,
        {
          token: candidate.token,
          createWorkspaceId: collisionWorkspace,
          sha256: candidate.sha256,
          format: candidate.format,
        },
        {
          root: value.contentRoot,
          assetRoot: value.assetRoot,
          store: value.store,
        },
      ),
      (error: unknown) =>
        error instanceof ArtistsCreateError &&
        error.code === "content-id-collision",
    );
    assert.deepEqual(
      await readFile(path.join(value.assetRoot, "test-artist.png")),
      png,
    );
    await value.store.read(
      candidate.token,
      `create-${collisionWorkspace}`,
      collisionWorkspace,
    );
  } finally {
    await rm(value.root, { recursive: true });
  }
});
