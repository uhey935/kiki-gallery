import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateNewsCapabilities } from "./capabilities.ts";
import { newsEntriesFromUnits } from "./entry-adapter.ts";
import { loadNewsRepository } from "./repository.ts";
import { newsEntrySchema } from "./schema.ts";

async function writeUnit(
  root: string,
  contentId: string,
  options: { en?: string; shared?: string } = {},
) {
  const directory = path.join(root, contentId);
  await fs.mkdir(directory);
  await fs.writeFile(
    path.join(directory, "index.yaml"),
    options.shared ??
      'date: "2026-03-28"\nnews_type: general\nlink: /news/site-launch\nshow_on_home: true\n',
  );
  await fs.writeFile(
    path.join(directory, "ja.md"),
    "---\ntitle: サイト公開のお知らせ\nsummary: 日本語要約\n---\n日本語本文\n",
  );
  if (options.en !== undefined) {
    await fs.writeFile(path.join(directory, "en.md"), options.en);
  }
}

test("loads independent locale entries without JA/EN fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiki-news-loader-"));
  try {
    await writeUnit(root, "site-launch", {
      en: "---\ntitle: Website launched\nsummary: English summary\n---\nEnglish body\n",
    });
    await writeUnit(root, "ja-only");
    const units = await loadNewsRepository(root);
    const entries = newsEntriesFromUnits(units);
    assert.deepEqual(
      entries.map((entry) => entry.id),
      ["ja::ja-only", "ja::site-launch", "en::site-launch"],
    );
    assert.equal(
      entries.find((entry) => entry.id === "en::ja-only"),
      undefined,
    );
    assert.equal(units[0].locales.en.state, "missing");
    assert.equal(evaluateNewsCapabilities(units[0]).preview.en.allowed, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("shared and locale schemas reject cross-file fields", () => {
  assert.equal(
    newsEntrySchema.safeParse({
      contentId: "site-launch",
      locale: "ja",
      date: "2026-03-28",
      news_type: "general",
      link: "/news/site-launch",
      show_on_home: true,
      title: "サイト公開のお知らせ",
    }).success,
    true,
  );
  assert.equal(
    newsEntrySchema.safeParse({
      contentId: "site-launch",
      locale: "ja",
      date: "2026-02-30",
      news_type: "general",
      show_on_home: false,
      title: "Invalid date",
    }).success,
    false,
  );
});

test("invalid shared data prevents entries for both locales", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kiki-news-loader-"));
  try {
    await writeUnit(root, "broken-shared", {
      shared: 'date: "2026-03-28"\nnews_type: general\nshow_on_home: true\n',
      en: "---\ntitle: Website launched\n---\n",
    });
    const units = await loadNewsRepository(root);
    assert.equal(units[0].shared.state, "invalid");
    assert.deepEqual(newsEntriesFromUnits(units), []);
    assert.equal(evaluateNewsCapabilities(units[0]).publish.allowed, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
