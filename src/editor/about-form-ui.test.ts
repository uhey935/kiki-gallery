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
  assert.equal((form.match(/SEO metadata/g) ?? []).length, 1);
  assert.equal(
    (form.match(/name=\{`\$\{locale\}_seo_title`\}/g) ?? []).length,
    1,
  );
  assert.equal(
    (form.match(/name=\{`\$\{locale\}_description`\}/g) ?? []).length,
    1,
  );
  assert.match(form, /data-editor-section=\{`\$\{locale\}-content`\}/);
  assert.match(form, /data-editor-section=\{`\$\{locale\}-metadata`\}/);
  assert.match(form, /SEO description · Optional/);
});
