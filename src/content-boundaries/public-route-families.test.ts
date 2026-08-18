import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { routeFamilyAvailable } from "./public-route-families.ts";

test("public route-family availability describes page implementations only", () => {
  for (const family of [
    "artists-index",
    "artist-detail",
    "exhibitions-index",
    "exhibition-detail",
    "work-detail",
    "news-index",
  ] as const) {
    assert.equal(routeFamilyAvailable(family, "ja"), true);
    assert.equal(routeFamilyAvailable(family, "en"), true);
  }

  for (const family of ["journal-index", "journal-detail"] as const) {
    assert.equal(routeFamilyAvailable(family, "ja"), true);
    assert.equal(routeFamilyAvailable(family, "en"), false);
  }

  for (const family of ["home", "about"] as const) {
    assert.equal(routeFamilyAvailable(family, "ja"), true);
    assert.equal(routeFamilyAvailable(family, "en"), true);
  }

  for (const family of ["privacy"] as const) {
    assert.equal(routeFamilyAvailable(family, "ja"), true);
    assert.equal(routeFamilyAvailable(family, "en"), false);
  }
});

test("EN Home and About share one capability-gated singleton implementation", async () => {
  const source = await readFile("src/pages/en/[...singleton].astro", "utf8");
  assert.match(source, /formal\("en"\)/);
  assert.match(source, /singleton: undefined/);
  assert.match(source, /singleton: "about"/);
  assert.match(source, /locale="en"/);
});

test("JA singleton consumers automatically retire development projections", async () => {
  const [home, about] = await Promise.all([
    readFile("src/pages/index.astro", "utf8"),
    readFile("src/pages/about.astro", "utf8"),
  ]);
  assert.match(home, /formal\("ja"\) \?\? homeFacade\.developmentJa\(\)/);
  assert.match(about, /formal\("ja"\) \?\? aboutFacade\.developmentJa\(\)/);
});

test("localized Artist and Work pages pass explicit locale metadata", async () => {
  const [
    jaArtist,
    enArtistIndex,
    enArtistDetail,
    jaWork,
    enWork,
    workPreview,
    workLayout,
  ] = await Promise.all(
    [
      "src/pages/artists/index.astro",
      "src/pages/en/artists/index.astro",
      "src/pages/en/artists/[slug].astro",
      "src/pages/works/[slug].astro",
      "src/pages/en/works/[slug].astro",
      "src/editor/routes/works-preview.astro",
      "src/layouts/WorkLayout.astro",
    ].map((file) => readFile(file, "utf8")),
  );

  assert.match(jaArtist, /<Layout[^>]*title="Artists"/);
  assert.match(enArtistIndex, /<Layout[^>]*locale="en"/s);
  assert.match(enArtistDetail, /<Layout[^>]*locale="en"/s);
  assert.match(jaWork, /<WorkLayout[^>]*locale="ja"/s);
  assert.match(enWork, /<WorkLayout[^>]*locale="en"/s);
  assert.match(workPreview, /<WorkLayout[^>]*locale=\{preview\.locale\}/s);
  assert.match(workLayout, /<html lang=\{locale\}>/);
});
