import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("About hours form uses canonical weekday checkboxes and no derived fields", async () => {
  const form = await readFile(
    path.resolve("src/components/editor/AboutDraftForm.astro"),
    "utf8",
  );
  const workspace = await readFile(
    path.resolve("src/pages/editor/about/workspace/[contentId].astro"),
    "utf8",
  );

  const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  assert.deepEqual(
    weekdays.map((weekday) => form.indexOf(`\"${weekday}\"`)),
    [...weekdays]
      .map((weekday) => form.indexOf(`\"${weekday}\"`))
      .sort((a, b) => a - b),
  );
  assert.equal((form.match(/name="open_days"/g) ?? []).length, 1);
  assert.match(form, /type="checkbox"/);
  assert.match(form, /shared\.hours\.open_days\.includes\(value\)/);
  assert.match(workspace, /data\.getAll\("open_days"\)/);
  assert.doesNotMatch(form, /closed_days|timezone/);
  assert.doesNotMatch(workspace, /closed_days|timezone/);
  assert.equal((form.match(/Localized content/g) ?? []).length, 1);
  assert.equal((form.match(/Localized metadata/g) ?? []).length, 1);
  assert.equal((form.match(/<h2>Metadata<\/h2>/g) ?? []).length, 1);
  assert.equal(
    (form.match(/name=\{`\$\{locale\}_seo_title`\}/g) ?? []).length,
    1,
  );
  assert.equal(
    (form.match(/name=\{`\$\{locale\}_description`\}/g) ?? []).length,
    1,
  );
  assert.match(form, /data-editor-section=\{`\$\{locale\}-content`\}/);
  assert.doesNotMatch(form, /data-editor-section=\{`\$\{locale\}-metadata`\}/);
  assert.match(form, /data-editor-section="metadata"/);
  assert.match(form, /data-editor-metadata-locale=\{locale\}/);
  assert.match(form, /locale === "ja" \? "Japanese" : "English"/);
  const contentStart = form.indexOf(
    "data-editor-section={`${locale}-content`}",
  );
  const metadataStart = form.indexOf('data-editor-section="metadata"');
  assert.ok(contentStart >= 0 && metadataStart > contentStart);
  const contentSource = form.slice(contentStart, metadataStart);
  assert.doesNotMatch(contentSource, /seo_title|_description/);
  assert.match(form.slice(metadataStart), /SEO title/);
  assert.match(form.slice(metadataStart), /SEO description/);
  assert.match(form, /data-about-image-slot="hero"/);
  assert.match(form, /data-about-thumbnail/);
  assert.match(form, /name="hero_src"\s+data-about-image-select/);
  assert.equal(
    (form.match(/data-about-image-slot=\{`gallery-/g) ?? []).length,
    1,
  );
  assert.match(form, /name=\{`ja_gallery_\$\{index\}_alt`\}/);
  assert.match(form, /name=\{`en_gallery_\$\{index\}_alt`\}/);
  assert.doesNotMatch(form, /Gallery \{index \+ 1\} alt/);
  assert.match(form, /<h2>Media<\/h2>/);
  assert.match(form, /<h2>Hours<\/h2>/);
  assert.match(form, /<h2>Contact<\/h2>/);
  assert.match(form, /name="email"\s+type="email"/);
  assert.match(form, /name="map_url"\s+type="url"/);
  assert.match(form, /name="instagram_url"\s+type="url"/);
  assert.match(workspace, /window\.addEventListener\("beforeunload"/);
  assert.match(workspace, /thumbnail\.src = select\.value/);
});
