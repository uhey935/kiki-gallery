import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createWorksEditorDraft,
  validateWorksEditorDraft,
} from "./works-draft-state.ts";
import {
  readWorksEditorEntry,
  readWorksEditorState,
  WorksEditorEntryNotFoundError,
} from "./works-state.ts";
import { serializeWorksEditorUnit } from "./works-serializer.ts";
import {
  saveWorksEditorDraft,
  writeWorksSerializedUnit,
  WorksSaveError,
} from "./works-save.ts";
import {
  createWorksPreviewModel,
  temporaryWorksAssetPreviewUrl,
  WorksPreviewError,
  WorksPreviewStore,
} from "./works-preview.ts";
import {
  addTemporaryWorksAsset,
  createWorksAssetDraftState,
  removeTemporaryWorksAssetFromDraft,
  replaceExistingWorksAsset,
  reorderWorksAssetDraftImage,
  updateWorksAssetDraftAlt,
} from "./works-asset-draft.ts";
import { readFile, mkdir, symlink } from "node:fs/promises";
import { writeThreeFileWorkFixture } from "./test-three-file-work-fixture.ts";

const validSource = `---
title: Test Work
artist: test-artist
images:
  - src: /images/test.jpg
    alt: Test image
size: H100 × W100 mm
material: Paper
year: 2026
inquiry:
  type: inquiry
---
Localized body
`;

async function fixture(source = validSource) {
  const root = await mkdtemp(path.join(tmpdir(), "works-editor-"));
  if (source === validSource) await writeThreeFileWorkFixture(root);
  else {
    await writeThreeFileWorkFixture(root);
    await writeFile(path.join(root, "test-work/ja.md"), source);
  }
  return root;
}

test("reads a three-file Works unit into an entry and list state", async () => {
  const root = await fixture();
  const entry = await readWorksEditorEntry("test-work", root);
  assert.equal(entry.data?.artist.id, "test-artist");
  assert.equal(entry.data?.images[0].src, "/images/works/existing.png");
  assert.equal(entry.body, "Body\n");
  assert.deepEqual(
    (await readWorksEditorState(root)).entries.map(
      ({ contentId }) => contentId,
    ),
    ["test-work"],
  );
});

test("creates an immutable Works-specific Draft", async () => {
  const entry = await readWorksEditorEntry("test-work", await fixture());
  const draft = createWorksEditorDraft(entry);
  assert.ok(draft);
  draft.data.images[0].src = "/images/changed.jpg";
  assert.equal(entry.data?.images[0].src, "/images/works/existing.png");
});

test("validates Drafts with canonical Work rules", async () => {
  const entry = await readWorksEditorEntry("test-work", await fixture());
  const draft = createWorksEditorDraft(entry);
  assert.ok(draft);
  draft.data.images.push(structuredClone(draft.data.images[0]));
  assert.match(
    validateWorksEditorDraft(draft).issues[0].messageKey,
    /Duplicate Work image path/,
  );
});

test("creates a complete Works preview model from an unsaved Draft", async () => {
  const draft = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", await fixture()),
  );
  assert.ok(draft);
  draft.data.title = "Unsaved title";
  draft.data.images[0] = { src: "/images/draft.jpg", alt: "Draft alt" };
  draft.body = "Unsaved **body**";
  const preview = createWorksPreviewModel(draft);
  assert.equal(preview.data.title, "Unsaved title");
  assert.deepEqual(preview.data.artist, {
    id: "test-artist",
    collection: "artists",
  });
  assert.deepEqual(preview.data.images[0], {
    src: "/images/draft.jpg",
    alt: "Draft alt",
  });
  assert.equal(preview.data.material, "Paper");
  assert.equal(preview.data.size, "H100 × W100 mm");
  assert.equal(preview.data.year, 2026);
  assert.equal(preview.data.inquiry.type, "inquiry");
  assert.equal(preview.body, "Unsaved **body**");
});

test("Works preview resolves mixed existing and temporary Asset Draft images in Draft order", async () => {
  const draft = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", await fixture()),
  );
  assert.ok(draft);
  let assets = createWorksAssetDraftState(
    draft.contentId,
    "workspace-1",
    draft.data.images,
  );
  assets = addTemporaryWorksAsset(assets, {
    token: "a".repeat(64),
    alt: "Pending image",
  });
  assets = reorderWorksAssetDraftImage(assets, 1, 0);
  assets = updateWorksAssetDraftAlt(assets, 1, "Existing image");

  const preview = createWorksPreviewModel(draft, assets);
  assert.deepEqual(preview.data.images, [
    {
      src: temporaryWorksAssetPreviewUrl(
        "a".repeat(64),
        "test-work",
        "workspace-1",
      ),
      alt: "Pending image",
    },
    { src: "/images/works/existing.png", alt: "Existing image" },
  ]);
  assert.equal(draft.data.images[0].alt, "Existing");
});

test("Works preview follows capability gating", async () => {
  const draft = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", await fixture()),
  );
  assert.ok(draft);
  assert.equal(validateWorksEditorDraft(draft).capabilities.preview, true);
  draft.data.images[0].alt = "";
  assert.equal(validateWorksEditorDraft(draft).capabilities.preview, false);
  assert.throws(
    () => createWorksPreviewModel(draft),
    (error: unknown) =>
      error instanceof WorksPreviewError && error.code === "preview-blocked",
  );
});

test("EN preview projects Shared plus EN without JA fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "works-preview-en-"));
  await writeThreeFileWorkFixture(root, { enPlaceholder: false });
  const draft = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", root),
  )!;
  const before = structuredClone(draft.sourceFiles);
  const preview = createWorksPreviewModel(draft, undefined, "en");
  assert.equal(preview.locale, "en");
  assert.equal(preview.data.title, "Test Work EN");
  assert.equal(preview.data.artist.id, "test-artist");
  assert.deepEqual(preview.data.images, [
    { src: "/images/works/existing.png", alt: "Existing EN" },
  ]);
  assert.equal(preview.body, "English body\n");
  assert.notEqual(preview.data.title, draft.data.title);
  assert.deepEqual(
    (await readWorksEditorEntry("test-work", root)).rawFiles,
    before,
  );
});

test("replacement Preview preserves locale alts and Cancel restores the source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "works-preview-replace-"));
  await writeThreeFileWorkFixture(root, { enPlaceholder: false });
  const draft = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", root),
  )!;
  const token = "b".repeat(64);
  const initial = createWorksAssetDraftState(
    draft.contentId,
    "workspace-1",
    draft.data.images,
  );
  const replacement = replaceExistingWorksAsset(initial, 0, { token });
  assert.deepEqual(
    createWorksPreviewModel(draft, replacement, "ja").data.images,
    [
      {
        src: temporaryWorksAssetPreviewUrl(token, "test-work", "workspace-1"),
        alt: "Existing",
      },
    ],
  );
  assert.deepEqual(
    createWorksPreviewModel(draft, replacement, "en").data.images,
    [
      {
        src: temporaryWorksAssetPreviewUrl(token, "test-work", "workspace-1"),
        alt: "Existing EN",
      },
    ],
  );
  const cancelled = removeTemporaryWorksAssetFromDraft(replacement, token);
  assert.deepEqual(cancelled, initial);
  assert.deepEqual(
    createWorksPreviewModel(draft, cancelled, "ja").data.images,
    [{ src: "/images/works/existing.png", alt: "Existing" }],
  );
  assert.deepEqual(
    createWorksPreviewModel(draft, cancelled, "en").data.images,
    [{ src: "/images/works/existing.png", alt: "Existing EN" }],
  );
});

test("Works preview store rejects unsafe, mismatched, expired, and isolated state", async () => {
  const draft = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", await fixture()),
  );
  assert.ok(draft);
  let now = 100;
  const store = new WorksPreviewStore(50, () => now);
  const otherStore = new WorksPreviewStore(50, () => now);
  const token = store.create(createWorksPreviewModel(draft));
  assert.equal(store.read(token, "test-work").data.title, "Test Work");
  assert.throws(() => store.read("invalid", "test-work"), WorksPreviewError);
  assert.throws(() => store.read(token, "other-work"), WorksPreviewError);
  assert.throws(() => otherStore.read(token, "test-work"), WorksPreviewError);
  now = 150;
  assert.throws(
    () => store.read(token, "test-work"),
    (error: unknown) =>
      error instanceof WorksPreviewError && error.code === "preview-expired",
  );
});

test("all canonical Works sources round-trip byte-for-byte", async () => {
  const root = path.resolve("src/content/works");
  const state = await readWorksEditorState(root);
  assert.equal(state.entries.length, 7);
  for (const { contentId } of state.entries) {
    const entry = await readWorksEditorEntry(contentId, root);
    const draft = createWorksEditorDraft(entry);
    assert.ok(draft);
    assert.deepEqual(
      serializeWorksEditorUnit(draft),
      entry.rawFiles,
      contentId,
    );
  }
});

test("edit, serialize, save, and canonical reread reset the baseline", async () => {
  const root = await fixture();
  const baseline = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", root),
  );
  assert.ok(baseline);
  const draft = structuredClone(baseline);
  draft.data.title = "Changed Work";
  const saved = await saveWorksEditorDraft(draft, baseline, root);
  assert.equal(saved.data.title, "Changed Work");
  assert.equal(
    saved.sourceFiles?.ja,
    await readFile(path.join(root, "test-work/ja.md"), "utf8"),
  );
});

test("save rejects stale baselines and unsafe targets without overwriting", async () => {
  const root = await fixture();
  const baseline = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", root),
  );
  assert.ok(baseline);
  const draft = structuredClone(baseline);
  draft.data.title = "Changed Work";
  await writeFile(
    path.join(root, "test-work/ja.md"),
    baseline.sourceFiles!.ja.replace("Test Work", "External"),
  );
  await assert.rejects(
    () => saveWorksEditorDraft(draft, baseline, root),
    (error: unknown) =>
      error instanceof WorksSaveError && error.code === "canonical-mismatch",
  );
  const externalRaw = await readFile(
    path.join(root, "test-work/ja.md"),
    "utf8",
  );
  await assert.rejects(
    () =>
      writeWorksSerializedUnit(
        "test-work",
        serializeWorksEditorUnit(draft),
        baseline.sourceFiles!,
        root,
      ),
    (error: unknown) =>
      error instanceof WorksSaveError && error.code === "canonical-mismatch",
  );
  assert.equal(
    await readFile(path.join(root, "test-work/ja.md"), "utf8"),
    externalRaw,
  );
  await assert.rejects(
    () =>
      writeWorksSerializedUnit(
        "../test-work",
        baseline.sourceFiles!,
        baseline.sourceFiles!,
        root,
      ),
    WorksSaveError,
  );

  const symlinkRoot = await mkdtemp(path.join(tmpdir(), "works-symlink-"));
  await symlink(
    path.join(root, "test-work"),
    path.join(symlinkRoot, "test-work"),
  );
  await assert.rejects(
    () =>
      writeWorksSerializedUnit(
        "test-work",
        baseline.sourceFiles!,
        baseline.sourceFiles!,
        symlinkRoot,
      ),
    WorksSaveError,
  );
  const directoryRoot = await mkdtemp(path.join(tmpdir(), "works-directory-"));
  await mkdir(path.join(directoryRoot, "test-work"));
  await assert.rejects(
    () =>
      writeWorksSerializedUnit(
        "test-work",
        baseline.sourceFiles!,
        baseline.sourceFiles!,
        directoryRoot,
      ),
    WorksSaveError,
  );
});

test("write failure leaves the original Works source intact", async () => {
  const root = await fixture();
  const baseline = createWorksEditorDraft(
    await readWorksEditorEntry("test-work", root),
  )!;
  const fileSystem = {
    lstat: (await import("node:fs/promises")).lstat,
    readFile,
    rename: async () => {
      throw new Error("injected rename failure");
    },
    rm: (await import("node:fs/promises")).rm,
    writeFile,
  };
  await assert.rejects(
    () =>
      writeWorksSerializedUnit(
        "test-work",
        {
          ...baseline.sourceFiles!,
          ja: baseline.sourceFiles!.ja.replace("Test Work", "Changed"),
        },
        baseline.sourceFiles!,
        root,
        fileSystem,
      ),
    (error: unknown) =>
      error instanceof WorksSaveError && error.code === "save-failed",
  );
  assert.deepEqual(
    (await readWorksEditorEntry("test-work", root)).rawFiles,
    baseline.sourceFiles,
  );
});

test("reports schema issues and rejects unsafe or unknown IDs", async () => {
  const root = await fixture(validSource.replace("year: 2026", "year: -1"));
  assert.equal(
    (await readWorksEditorEntry("test-work", root)).structuralStatus,
    "issues",
  );
  await assert.rejects(
    () => readWorksEditorEntry("../test-work", root),
    WorksEditorEntryNotFoundError,
  );
  await assert.rejects(
    () => readWorksEditorEntry("missing", root),
    WorksEditorEntryNotFoundError,
  );
});
