import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createExhibitionsEditorDraft,
  normalizeExhibitionDateInput,
  validateExhibitionsEditorDraft,
} from "./exhibitions-draft-state.ts";
import {
  createExhibitionsPreviewModel,
  ExhibitionsPreviewError,
  ExhibitionsPreviewStore,
} from "./exhibitions-preview.ts";
import {
  saveExhibitionsEditorDraft,
  ExhibitionsSaveError,
} from "./exhibitions-save.ts";
import { serializeExhibitionsEditorDraft } from "./exhibitions-serializer.ts";
import {
  readExhibitionsEditorEntry,
  readExhibitionsEditorState,
} from "./exhibitions-state.ts";

const source = `---
title: Test Exhibition
artists:
  - artist-one
start_date: "2026-08-01"
end_date: "2026-08-10"
hero:
  image: /images/exhibitions/test.jpg
  orientation: landscape
hero_alt: Installation view
venue: KiKi Gallery
---

Body copy.
`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "exhibitions-editor-"));
  await writeFile(path.join(root, "test-exhibition.md"), source);
  return root;
}

test("reads a canonical Exhibition and preserves a clean serialization", async () => {
  const root = await fixture();
  try {
    const state = await readExhibitionsEditorState(root);
    assert.equal(state.entries[0]?.status, "valid");
    const draft = createExhibitionsEditorDraft(
      await readExhibitionsEditorEntry("test-exhibition", root),
    );
    assert.ok(draft);
    assert.equal(serializeExhibitionsEditorDraft(draft), source);
  } finally {
    await rm(root, { recursive: true });
  }
});
test("normalizes YYYY-MM-DD form values to canonical UTC midnight Dates", () => {
  const normalized = normalizeExhibitionDateInput("2026-08-09");
  assert.ok(normalized instanceof Date);
  assert.equal(normalized.toISOString(), "2026-08-09T00:00:00.000Z");
  assert.ok(Number.isNaN(normalizeExhibitionDateInput("2026-02-30").getTime()));
});
test("workspace date normalization preserves the canonical baseline shape", async () => {
  const root = await fixture();
  try {
    const canonical = createExhibitionsEditorDraft(
      await readExhibitionsEditorEntry("test-exhibition", root),
    )!;
    const workspaceBaseline = structuredClone(canonical);
    workspaceBaseline.data.start_date = normalizeExhibitionDateInput(
      canonical.data.start_date.toISOString().slice(0, 10),
    );
    workspaceBaseline.data.end_date = normalizeExhibitionDateInput(
      canonical.data.end_date.toISOString().slice(0, 10),
    );
    assert.deepEqual(workspaceBaseline, canonical);
  } finally {
    await rm(root, { recursive: true });
  }
});
test("date order blocks Save, Preview, and Publish", async () => {
  const root = await fixture();
  try {
    const draft = createExhibitionsEditorDraft(
      await readExhibitionsEditorEntry("test-exhibition", root),
    )!;
    draft.data.end_date = new Date("2026-07-31");
    const validation = validateExhibitionsEditorDraft(draft);
    assert.deepEqual(validation.capabilities, {
      save: false,
      preview: false,
      publish: false,
    });
    assert.throws(
      () => createExhibitionsPreviewModel(draft),
      (error: unknown) =>
        error instanceof ExhibitionsPreviewError &&
        error.code === "preview-blocked",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save atomically replaces only the selected canonical file", async () => {
  const root = await fixture();
  try {
    const canonical = createExhibitionsEditorDraft(
      await readExhibitionsEditorEntry("test-exhibition", root),
    )!;
    const baseline = structuredClone(canonical);
    baseline.data.start_date = normalizeExhibitionDateInput("2026-08-01");
    baseline.data.end_date = normalizeExhibitionDateInput("2026-08-10");
    assert.deepEqual(baseline, canonical);
    const draft = structuredClone(baseline);
    draft.data.title = "Changed";
    const saved = await saveExhibitionsEditorDraft(draft, baseline, root);
    assert.equal(saved.data.title, "Changed");
    assert.match(
      await readFile(path.join(root, "test-exhibition.md"), "utf8"),
      /title: Changed/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save refuses a stale baseline", async () => {
  const root = await fixture();
  try {
    const baseline = createExhibitionsEditorDraft(
      await readExhibitionsEditorEntry("test-exhibition", root),
    )!;
    const draft = structuredClone(baseline);
    draft.data.title = "Draft";
    await writeFile(
      path.join(root, "test-exhibition.md"),
      source.replace("Test Exhibition", "External"),
    );
    await assert.rejects(
      saveExhibitionsEditorDraft(draft, baseline, root),
      (error: unknown) =>
        error instanceof ExhibitionsSaveError &&
        error.code === "canonical-mismatch",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("preview tokens are content-bound and expire", () => {
  let now = 0;
  const store = new ExhibitionsPreviewStore(10, () => now);
  const model = {
    contentId: "test-exhibition",
    data: {
      artists: [{ id: "artist-one", collection: "artists" as const }],
      hero: { image: "/test.jpg", orientation: "landscape" as const },
      start_date: new Date("2026-08-01"),
      end_date: new Date("2026-08-02"),
      hero_alt: "Alt",
    },
    body: "Body",
  };
  const token = store.create(model);
  assert.equal(store.read(token, model.contentId).body, "Body");
  assert.throws(() => store.read(token, "other"));
  now = 10;
  assert.throws(
    () => store.read(token, model.contentId),
    (error: unknown) =>
      error instanceof ExhibitionsPreviewError &&
      error.code === "preview-expired",
  );
});
