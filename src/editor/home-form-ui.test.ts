import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Home form separates localized content from localized metadata", async () => {
  const form = await readFile(
    path.resolve("src/components/editor/HomeDraftForm.astro"),
    "utf8",
  );

  assert.match(form, /Localized metadata/);
  assert.match(form, /<h2>Metadata<\/h2>/);
  assert.match(form, /data-editor-section="metadata"/);
  assert.match(form, /name=\{`\$\{locale\}_seo_title`\}/);
  assert.match(form, /name=\{`\$\{locale\}_description`\}/);

  const localizedContent = form.slice(
    form.indexOf('(["ja", "en"] as const).map'),
    form.indexOf(
      '<section class="editor-entry-section" data-editor-section="metadata">',
    ),
  );
  assert.doesNotMatch(localizedContent, /SEO title|Description/);
  assert.doesNotMatch(form, /Copy finalized|Copy approved|Temporary/);
  assert.doesNotMatch(form, /copyStatus|TODO_HOME/);
  assert.equal((form.match(/About intro · Required/g) ?? []).length, 1);
});
