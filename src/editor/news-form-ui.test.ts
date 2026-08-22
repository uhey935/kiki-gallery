import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const formSource = () =>
  readFile(path.resolve("src/components/editor/NewsDraftForm.astro"), "utf8");

test("News Shared Link and Show on Home use the unboxed two-column field contract", async () => {
  const form = await formSource();

  assert.match(
    form,
    /<label data-editor-field="shared\.link">[\s\S]*?Link[\s\S]*?Optional[\s\S]*?<input[\s\S]*?name="shared\.link"/,
  );
  assert.match(
    form,
    /<div[\s\S]*?class="editor-news-home-field"[\s\S]*?data-editor-field="shared\.show_on_home"[\s\S]*?<span id="news-show-on-home-label">[\s\S]*?Show on Home[\s\S]*?Optional[\s\S]*?<label class="editor-news-home-field__control">[\s\S]*?<input[\s\S]*?name="shared\.show_on_home"[\s\S]*?type="checkbox"[\s\S]*?aria-labelledby="news-show-on-home-label"/,
  );
  assert.doesNotMatch(form, /<fieldset[^>]*>[\s\S]*?shared\.show_on_home/);
});

test("News Create and Workspace share the same News draft form", async () => {
  const [create, workspace] = await Promise.all([
    readFile(path.resolve("src/pages/editor/news/create.astro"), "utf8"),
    readFile(
      path.resolve("src/pages/editor/news/workspace/[contentId].astro"),
      "utf8",
    ),
  ]);

  for (const page of [create, workspace]) {
    assert.match(page, /import NewsDraftForm/);
    assert.match(page, /<NewsDraftForm draft={draft} \/>/);
  }
});
