import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createNewsEditorDraft,
  validateNewsEditorDraft,
} from "./news-draft-state.ts";
import {
  createNewsPreviewModel,
  NewsPreviewError,
  NewsPreviewStore,
} from "./news-preview.ts";
import { saveNewsEditorDraft, NewsSaveError } from "./news-save.ts";
import { serializeNewsEditorDraft } from "./news-serializer.ts";
import { readNewsEditorEntry, readNewsEditorState } from "./news-state.ts";

const source = `---
title: Test News
date: "2026-08-07"
news_type: artist
summary: Summary.
link: /artists/test-artist
show_on_home: true
---
`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-editor-"));
  await writeFile(path.join(root, "test-news.md"), source);
  return root;
}
test("reads canonical News and preserves clean serialization", async () => {
  const root = await fixture();
  try {
    const state = await readNewsEditorState(root);
    assert.equal(state.entries[0]?.status, "valid");
    const draft = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    );
    assert.ok(draft);
    assert.equal(serializeNewsEditorDraft(draft), source);
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Home-visible News requires a link and blocks every action", async () => {
  const root = await fixture();
  try {
    const draft = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    )!;
    draft.data.link = undefined;
    const validation = validateNewsEditorDraft(draft);
    assert.deepEqual(validation.capabilities, {
      save: false,
      preview: false,
      publish: false,
    });
    assert.throws(
      () => createNewsPreviewModel(draft),
      (error: unknown) =>
        error instanceof NewsPreviewError && error.code === "preview-blocked",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save atomically replaces only selected canonical News", async () => {
  const root = await fixture();
  try {
    const baseline = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    )!;
    const draft = structuredClone(baseline);
    draft.data.title = "Changed";
    const saved = await saveNewsEditorDraft(draft, baseline, root);
    assert.equal(saved.data.title, "Changed");
    assert.match(
      await readFile(path.join(root, "test-news.md"), "utf8"),
      /title: Changed/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save refuses stale baseline", async () => {
  const root = await fixture();
  try {
    const baseline = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    )!;
    const draft = structuredClone(baseline);
    draft.data.title = "Draft";
    await writeFile(
      path.join(root, "test-news.md"),
      source.replace("Test News", "External"),
    );
    await assert.rejects(
      saveNewsEditorDraft(draft, baseline, root),
      (error: unknown) =>
        error instanceof NewsSaveError && error.code === "canonical-mismatch",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("preview tokens are content-bound and expire", () => {
  let now = 0;
  const store = new NewsPreviewStore(10, () => now);
  const model = {
    contentId: "test-news",
    data: {
      title: "Test",
      date: "2026-08-07",
      news_type: "general" as const,
      show_on_home: false,
    },
  };
  const token = store.create(model);
  assert.equal(store.read(token, model.contentId).data.title, "Test");
  assert.throws(() => store.read(token, "other"));
  now = 10;
  assert.throws(
    () => store.read(token, model.contentId),
    (error: unknown) =>
      error instanceof NewsPreviewError && error.code === "preview-expired",
  );
});
