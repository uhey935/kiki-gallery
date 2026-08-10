import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createNewsEditorDraft,
  updateNewsEditorDraft,
  validateNewsEditorDraft,
} from "./news-draft-state.ts";
import {
  createNewsPreviewModel,
  NewsPreviewError,
  NewsPreviewStore,
} from "./news-preview.ts";
import {
  saveNewsEditorDraft,
  NewsSaveError,
  type NewsSaveFileSystem,
} from "./news-save.ts";
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

async function writeThreeFileNews(
  root: string,
  options: {
    index?: string;
    ja?: string;
    en?: string | null;
  } = {},
) {
  const directory = path.join(root, "test-news");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "index.yaml"),
    options.index ??
      `date: "2026-08-07"\nnews_type: artist\nlink: /artists/test-artist\nshow_on_home: true\n`,
  );
  await writeFile(
    path.join(directory, "ja.md"),
    options.ja ?? `---\ntitle: 三ファイルニュース\nsummary: 日本語概要\n---\n`,
  );
  if (options.en !== null)
    await writeFile(
      path.join(directory, "en.md"),
      options.en ??
        `---\ntitle: Three-file News\nsummary: English summary\n---\n`,
    );
}
test("reads canonical News and preserves clean serialization", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root);
    const state = await readNewsEditorState(root);
    assert.equal(state.entries[0]?.status, "valid");
    const draft = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    );
    assert.ok(draft);
    assert.deepEqual(serializeNewsEditorDraft(draft), {
      "index.yaml": `date: "2026-08-07"\nnews_type: artist\nlink: /artists/test-artist\nshow_on_home: true\n`,
      "ja.md": `---\ntitle: 三ファイルニュース\nsummary: 日本語概要\n---\n`,
      "en.md": `---\ntitle: Three-file News\nsummary: English summary\n---\n`,
    });
  } finally {
    await rm(root, { recursive: true });
  }
});
test("prefers three-file News while retaining the legacy compatibility source", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root);
    const entry = await readNewsEditorEntry("test-news", root);
    assert.equal(entry.sourceModel, "three-file");
    assert.equal(entry.shared?.date, "2026-08-07");
    assert.equal(entry.locales.ja?.title, "三ファイルニュース");
    assert.equal(entry.locales.en?.title, "Three-file News");
    assert.equal(entry.data?.title, "三ファイルニュース");
    assert.equal(entry.legacy?.data?.title, "Test News");
    assert.equal((await readNewsEditorState(root)).entries.length, 1);
  } finally {
    await rm(root, { recursive: true });
  }
});
test("reports invalid three-file shared data without using legacy values", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root, {
      index: `date: not-a-date\nnews_type: artist\nshow_on_home: false\n`,
    });
    const entry = await readNewsEditorEntry("test-news", root);
    assert.equal(entry.sourceModel, "three-file");
    assert.equal(entry.shared, undefined);
    assert.equal(entry.data, undefined);
    assert.equal(entry.structuralStatus, "issues");
    assert.ok(
      entry.issues.some((item) => item.ruleId === "content.shared.structure"),
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("reports a missing EN locale and does not fall back to JA", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root, { en: null });
    const entry = await readNewsEditorEntry("test-news", root);
    assert.equal(entry.locales.en, undefined);
    assert.equal(entry.locales.ja?.title, "三ファイルニュース");
    assert.ok(
      entry.issues.some(
        (item) =>
          item.ruleId === "content.locale.missing" && item.locale === "en",
      ),
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("detects unresolved EN placeholders independently from JA", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root, {
      en: `---\ntitle: __TODO_EN_TITLE__\nsummary: __TODO_EN_SUMMARY__\n---\n`,
    });
    const entry = await readNewsEditorEntry("test-news", root);
    assert.equal(entry.data?.title, "三ファイルニュース");
    assert.equal(
      entry.issues.filter(
        (item) =>
          item.ruleId === "content.placeholder.unresolved" &&
          item.locale === "en",
      ).length,
      2,
    );
    assert.equal(
      entry.issues.some(
        (item) =>
          item.ruleId === "content.placeholder.unresolved" &&
          item.locale === "ja",
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("localized News Draft gates JA and EN Preview independently", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root, {
      en: `---\ntitle: __TODO_EN_TITLE__\nsummary: __TODO_EN_SUMMARY__\n---\n`,
    });
    const draft = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    )!;
    assert.deepEqual(validateNewsEditorDraft(draft).capabilities.preview, {
      ja: true,
      en: false,
    });
    const translated = updateNewsEditorDraft(draft, (next) => {
      if (next.locales.en.state !== "editable") return;
      next.locales.en.value.title = "Translated title";
      next.locales.en.value.summary = "Translated summary";
    });
    assert.deepEqual(validateNewsEditorDraft(translated).capabilities.preview, {
      ja: true,
      en: true,
    });
    assert.equal(createNewsPreviewModel(translated, "en").locale, "en");
    assert.equal(
      createNewsPreviewModel(translated, "en").data.title,
      "Translated title",
    );
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
      preview: { ja: false, en: false },
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
    await writeThreeFileNews(root);
    const baseline = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    )!;
    const draft = structuredClone(baseline);
    if (draft.locales.ja.state === "editable")
      draft.locales.ja.value.title = "Changed";
    const saved = await saveNewsEditorDraft(draft, baseline, root);
    assert.equal(saved.data.title, "Changed");
    assert.match(
      await readFile(path.join(root, "test-news/ja.md"), "utf8"),
      /title: Changed/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save refuses stale baseline", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root);
    const baseline = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    )!;
    const draft = structuredClone(baseline);
    if (draft.locales.ja.state === "editable")
      draft.locales.ja.value.title = "Draft";
    await writeFile(
      path.join(root, "test-news/ja.md"),
      `---\ntitle: External\n---\n`,
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
test("a News replacement failure restores the complete baseline", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root);
    const directory = path.join(root, "test-news");
    const baseline = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    )!;
    const draft = structuredClone(baseline);
    if (draft.locales.ja.state === "editable")
      draft.locales.ja.value.title = "未保存";
    const before = await Promise.all(
      ["index.yaml", "ja.md", "en.md"].map((name) =>
        readFile(path.join(directory, name), "utf8"),
      ),
    );
    let stagedRenames = 0;
    const failing: NewsSaveFileSystem = {
      ...fs,
      async rename(oldPath, newPath) {
        if (String(oldPath).includes("-stage") && ++stagedRenames === 2)
          throw new Error("injected replacement failure");
        await fs.rename(oldPath, newPath);
      },
    };
    await assert.rejects(
      saveNewsEditorDraft(draft, baseline, root, failing),
      (error: unknown) =>
        error instanceof NewsSaveError && error.code === "save-failed",
    );
    const after = await Promise.all(
      ["index.yaml", "ja.md", "en.md"].map((name) =>
        readFile(path.join(directory, name), "utf8"),
      ),
    );
    assert.deepEqual(after, before);
    assert.deepEqual(
      (await fs.readdir(directory)).filter((name) =>
        name.startsWith(".news-save-"),
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("a News rollback failure preserves manual recovery evidence", async () => {
  const root = await fixture();
  try {
    await writeThreeFileNews(root);
    const directory = path.join(root, "test-news");
    const baseline = createNewsEditorDraft(
      await readNewsEditorEntry("test-news", root),
    )!;
    const baselineIndex = await readFile(
      path.join(directory, "index.yaml"),
      "utf8",
    );
    const draft = structuredClone(baseline);
    if (draft.locales.ja.state === "editable")
      draft.locales.ja.value.title = "未保存";
    let stagedRenames = 0;
    const failing: NewsSaveFileSystem = {
      ...fs,
      async rename(oldPath, newPath) {
        if (String(oldPath).includes("-stage") && ++stagedRenames === 2)
          throw new Error("injected replacement failure");
        if (String(oldPath).includes("-backup"))
          throw new Error("injected rollback failure");
        await fs.rename(oldPath, newPath);
      },
    };
    await assert.rejects(
      saveNewsEditorDraft(draft, baseline, root, failing),
      (error: unknown) =>
        error instanceof NewsSaveError &&
        error.code === "news-save-rollback-failed",
    );
    const evidence = (await fs.readdir(directory)).filter((name) =>
      name.startsWith(".news-save-"),
    );
    assert.equal(evidence.length, 2);
    const backup = evidence.find((name) => name.endsWith("-backup"));
    assert.ok(backup);
    assert.equal(
      await readFile(path.join(directory, backup, "index.yaml"), "utf8"),
      baselineIndex,
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
