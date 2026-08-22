import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

test("Journal form uses category and visibility selects with excerpt guidance", async () => {
  const [form, locale] = await Promise.all([
    fs.readFile(
      path.resolve("src/components/editor/EntryDraftForm.astro"),
      "utf8",
    ),
    fs.readFile(
      path.resolve("src/components/editor/LocaleDraftSection.astro"),
      "utf8",
    ),
  ]);
  assert.match(form, /<select name="shared\.category">/);
  assert.match(form, /Select a category/);
  assert.doesNotMatch(form, /name="shared\.categories"/);
  assert.match(form, /Site visibility/);
  assert.match(form, /<select name="shared\.visibility">/);
  assert.match(form, /<option[\s\S]*?value="draft"[\s\S]*?>[\s\S]*?Draft/);
  assert.match(form, /<option[\s\S]*?value="public"[\s\S]*?>[\s\S]*?Public/);
  assert.doesNotMatch(form, /value="hidden"/);
  assert.match(form, /Draft: not available on public Journal routes/);
  assert.match(form, /Publish sends saved changes/);
  assert.doesNotMatch(form, /name="shared\.author"/);
  assert.doesNotMatch(form, />\s*Author\s*</);
  assert.match(locale, /Journal excerpt/);
  assert.match(locale, /Shown when this Journal is included in News/);
  assert.match(form, /Localized metadata/);
  assert.match(form, /<h2>Metadata<\/h2>/);
  assert.match(form, /name=\{`\$\{locale\}\.seo_title`\}/);
  assert.match(form, /name=\{`\$\{locale\}\.description`\}/);
  assert.match(form, /Leave SEO title blank to use the Journal Title/);
  assert.match(form, /blank to use the Journal excerpt/);
});
