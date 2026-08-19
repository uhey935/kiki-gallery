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
