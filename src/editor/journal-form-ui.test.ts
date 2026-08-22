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
  assert.match(form, /Hidden: not available on public Journal routes/);
  assert.match(form, /Publish sends saved changes/);
  assert.doesNotMatch(form, /name="shared\.author"/);
  assert.doesNotMatch(form, />\s*Author\s*</);
  assert.match(locale, /Journal excerpt/);
  assert.match(locale, /Shown when this Journal is included in News/);
});
