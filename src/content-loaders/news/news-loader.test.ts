import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { evaluateNewsCapabilities } from "./capabilities.ts";
import { newsEntriesFromUnits } from "./entry-adapter.ts";
import { loadNewsRepository, loadNewsUnit } from "./repository.ts";
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

async function temporaryNewsUnit(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-topology-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeUnit(root, "exact-news", {
    en: "---\ntitle: Website launched\nsummary: English summary\n---\nEnglish body\n",
  });
  return { root, unit: path.join(root, "exact-news") };
}

function assertNewsRepositoryIntegrity(
  unit: Awaited<ReturnType<typeof loadNewsUnit>>,
) {
  assert.ok(
    unit.issues.some(
      (issue) =>
        issue.ruleId === "content.repository.inventory" &&
        issue.category === "repository-integrity",
    ),
  );
  const capabilities = evaluateNewsCapabilities(unit);
  assert.equal(capabilities.save.allowed, false);
  assert.equal(capabilities.preview.ja.allowed, false);
  assert.equal(capabilities.preview.en.allowed, false);
  assert.equal(capabilities.publish.allowed, false);
}

test("News repository accepts only exact, safe localized units", async (t) => {
  await t.test("valid exact unit", async (t) => {
    const { unit } = await temporaryNewsUnit(t);
    const loaded = await loadNewsUnit(unit);
    assert.equal(loaded.issues.length, 0);
    assert.deepEqual(
      newsEntriesFromUnits([loaded]).map((entry) => entry.id),
      ["ja::exact-news", "en::exact-news"],
    );
  });

  for (const expected of ["index.yaml", "ja.md", "en.md"] as const) {
    await t.test(`missing ${expected}`, async (t) => {
      const { unit } = await temporaryNewsUnit(t);
      await fs.rm(path.join(unit, expected));
      const loaded = await loadNewsUnit(unit);
      if (expected === "index.yaml") {
        assert.equal(loaded.shared.state, "missing");
        assert.ok(
          loaded.issues.some(
            (issue) => issue.ruleId === "content.file.missing",
          ),
        );
      } else {
        const locale = expected.slice(0, 2) as "ja" | "en";
        const sibling = locale === "ja" ? "en" : "ja";
        assert.equal(loaded.locales[locale].state, "missing");
        assert.ok(
          loaded.issues.some(
            (issue) =>
              issue.ruleId === "content.locale.missing" &&
              issue.locale === locale,
          ),
        );
        const capabilities = evaluateNewsCapabilities(loaded);
        assert.equal(capabilities.preview[locale].allowed, false);
        assert.equal(capabilities.preview[sibling].allowed, true);
      }
    });
  }

  for (const topology of ["extra", "nested"] as const) {
    await t.test(topology, async (t) => {
      const { unit } = await temporaryNewsUnit(t);
      if (topology === "extra")
        await fs.writeFile(path.join(unit, "extra.txt"), "unexpected");
      else {
        await fs.mkdir(path.join(unit, "nested"));
        await fs.writeFile(path.join(unit, "nested", "entry.md"), "nested");
      }
      assertNewsRepositoryIntegrity(await loadNewsUnit(unit));
    });
  }

  for (const expected of ["index.yaml", "ja.md", "en.md"] as const) {
    await t.test(`symlinked ${expected}`, async (t) => {
      const { root, unit } = await temporaryNewsUnit(t);
      const source = path.join(unit, expected);
      const target = path.join(root, `target-${expected.replace(".", "-")}`);
      await fs.rename(source, target);
      await fs.symlink(target, source);
      assertNewsRepositoryIntegrity(await loadNewsUnit(unit));
    });
  }

  await t.test("non-regular expected source", async (t) => {
    const { unit } = await temporaryNewsUnit(t);
    await fs.rm(path.join(unit, "ja.md"));
    await fs.mkdir(path.join(unit, "ja.md"));
    assertNewsRepositoryIntegrity(await loadNewsUnit(unit));
  });

  await t.test("unexpected root entry", async (t) => {
    const { root } = await temporaryNewsUnit(t);
    await fs.writeFile(path.join(root, "unexpected.txt"), "unexpected");
    await assert.rejects(loadNewsRepository(root), /extra|non-directory/);
  });
});

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
