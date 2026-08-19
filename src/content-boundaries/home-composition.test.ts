import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { selectHomeStories } from "./home-story-selection.ts";

test("Home story selection combines, date-sorts, limits, and strips composition dates", () => {
  const story = (date: string, title: string) => ({
    date,
    title,
    href: `/${title}/`,
    image: `/${title}.jpg`,
    alt: title,
  });
  const selected = selectHomeStories(
    [story("2026-01-01", "news-old"), story("2026-03-01", "news-new")],
    Array.from({ length: 6 }, (_, index) =>
      story(`2026-02-0${index + 1}`, `journal-${index}`),
    ),
  );
  assert.equal(selected.length, 6);
  assert.equal(selected[0].title, "news-new");
  assert.equal(
    selected.some((entry) => "date" in entry),
    false,
  );
  assert.equal(
    selected.some((entry) => entry.title === "news-old"),
    false,
  );
});

test("all Home consumers share composition and presentation boundaries", async () => {
  const files = await Promise.all(
    [
      "src/pages/index.astro",
      "src/pages/en/[...singleton].astro",
      "src/editor/routes/home-preview.astro",
    ].map((path) => readFile(path, "utf8")),
  );
  for (const source of files) {
    assert.match(source, /createHomePresentationModel/);
    assert.match(source, /HomePresentation/);
    assert.doesNotMatch(source, /home-stories__item/);
    assert.doesNotMatch(source, /home-exhibition__item/);
  }
});

test("Production and Preview cannot diverge in Home story IDs", async () => {
  const [ja, en, preview] = await Promise.all(
    [
      "src/pages/index.astro",
      "src/pages/en/[...singleton].astro",
      "src/editor/routes/home-preview.astro",
    ].map((path) => readFile(path, "utf8")),
  );
  for (const source of [ja, en, preview])
    assert.match(source, /createHomePresentationModel/);
  assert.doesNotMatch(preview, /forHomeStories|forHome\(|selectHomeStories/);
});

test("HomePresentation omits empty optional sections and renders nonempty sections", async () => {
  const source = await readFile(
    "src/components/HomePresentation.astro",
    "utf8",
  );
  assert.match(source, /exhibitions\.length > 0 && exhibitionsHref/);
  assert.match(source, /stories\.length > 0 && storiesHref/);
  assert.match(source, /stories\.map\(\(story\)/);
  assert.match(source, /exhibitions\.map\(\(exhibition\)/);
});

test("Journal candidates require locale-route availability before Home selection", async () => {
  const source = await readFile(
    "src/content-boundaries/home-composition.ts",
    "utf8",
  );
  assert.match(source, /journalFacade\.forHomeStories\(locale\)/);
  assert.match(source, /route\.kind === "available"/);
  assert.match(source, /selectHomeStories\(newsStories, journalStories\)/);
});
