import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createArtistsEditorDraft,
  validateArtistsEditorDraft,
} from "./artists-draft-state.ts";
import {
  createArtistsPreviewModel,
  ArtistsPreviewError,
  ArtistsPreviewStore,
} from "./artists-preview.ts";
import { saveArtistsEditorDraft, ArtistsSaveError } from "./artists-save.ts";
import { serializeArtistsEditorDraft } from "./artists-serializer.ts";
import {
  readArtistsEditorEntry,
  readArtistsEditorState,
} from "./artists-state.ts";

const shared = `sort_name: Test Artist
hero:
  image: /images/artists/test.jpg
medium:
  - Painting
works_layout:
  - layout: single-a
    works:
      - test-work
`;
const ja = `---
name: テスト作家
short_bio: Short biography.
biography: Full biography.
hero_alt: Test artwork
---
`;
const en = `---
name: Test Artist
short_bio: Short biography.
hero_alt: Test artwork
---
`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "artists-editor-"));
  const directory = path.join(root, "test-artist");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(directory));
  await Promise.all([
    writeFile(path.join(directory, "index.yaml"), shared),
    writeFile(path.join(directory, "ja.md"), ja),
    writeFile(path.join(directory, "en.md"), en),
  ]);
  return root;
}

test("reads a canonical Artist and preserves a clean serialization", async () => {
  const root = await fixture();
  try {
    const state = await readArtistsEditorState(root);
    assert.equal(state.entries[0]?.status, "valid");
    const draft = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", root),
    );
    assert.ok(draft);
    assert.deepEqual(serializeArtistsEditorDraft(draft), { "index.yaml": shared, "ja.md": ja, "en.md": en });
  } finally {
    await rm(root, { recursive: true });
  }
});
test("layout count and duplicate Work references block all actions", async () => {
  const root = await fixture();
  try {
    const draft = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", root),
    )!;
    draft.data.works_layout = [
      {
        layout: "double-a",
        works: [
          { id: "test-work", collection: "works" },
          { id: "test-work", collection: "works" },
        ],
      },
    ];
    const validation = validateArtistsEditorDraft(draft);
    assert.deepEqual(validation.capabilities, {
      save: false,
      preview: false,
      localePreview: { ja: false, en: false },
      publish: false,
    });
    assert.throws(
      () => createArtistsPreviewModel(draft),
      (error: unknown) =>
        error instanceof ArtistsPreviewError &&
        error.code === "preview-blocked",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save atomically replaces only the selected canonical file", async () => {
  const root = await fixture();
  try {
    const baseline = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", root),
    )!;
    const draft = structuredClone(baseline);
    draft.data.name = "Changed Artist";
    const saved = await saveArtistsEditorDraft(draft, baseline, root);
    assert.equal(saved.data.name, "Changed Artist");
    assert.match(
      await readFile(path.join(root, "test-artist/index.yaml"), "utf8"),
      /sort_name: Changed Artist/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save refuses a stale baseline", async () => {
  const root = await fixture();
  try {
    const baseline = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", root),
    )!;
    const draft = structuredClone(baseline);
    draft.data.name = "Draft";
    await writeFile(
      path.join(root, "test-artist/index.yaml"),
      shared.replace("Test Artist", "External"),
    );
    await assert.rejects(
      saveArtistsEditorDraft(draft, baseline, root),
      (error: unknown) =>
        error instanceof ArtistsSaveError &&
        error.code === "canonical-mismatch",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("preview tokens are content-bound and expire", () => {
  let now = 0;
  const store = new ArtistsPreviewStore(10, () => now);
  const model = {
    contentId: "test-artist",
    data: {
      name: "Test Artist",
      hero: { image: "/test.jpg" },
      hero_alt: "Alt",
      short_bio: "Bio",
      medium: ["Painting"],
    },
    body: "",
  };
  const token = store.create(model);
  assert.equal(store.read(token, model.contentId).data.name, "Test Artist");
  assert.throws(() => store.read(token, "other"));
  now = 10;
  assert.throws(
    () => store.read(token, model.contentId),
    (error: unknown) =>
      error instanceof ArtistsPreviewError && error.code === "preview-expired",
  );
});
