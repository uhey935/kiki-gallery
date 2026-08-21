import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all Artist detail surfaces use the shared presentation", async () => {
  const [jaRoute, enRoute, previewRoute] = await Promise.all([
    readFile("src/pages/artists/[slug].astro", "utf8"),
    readFile("src/pages/en/artists/[slug].astro", "utf8"),
    readFile("src/editor/routes/artists-preview.astro", "utf8"),
  ]);
  for (const source of [jaRoute, enRoute, previewRoute]) {
    assert.match(source, /ArtistDetailPresentation/);
  }
  assert.doesNotMatch(previewRoute, /styles\/artists\.css/);
  assert.match(previewRoute, /locale=\{preview\.locale\}/);
  assert.match(previewRoute, /getWorksProductionFacade/);
  assert.doesNotMatch(previewRoute, /Works layout/);
  const presentation = await readFile(
    "src/components/ArtistDetailPresentation.astro",
    "utf8",
  );
  assert.match(presentation, /artist\.mediumLabel/);
  assert.doesNotMatch(presentation, /artist\.medium(?:\W|$)/);
});

test("generated JA and EN Artist details retain shared Hero and Work output", async () => {
  const [ja, en] = await Promise.all([
    readFile("dist/artists/reiko-kinoshita/index.html", "utf8"),
    readFile("dist/en/artists/reiko-kinoshita/index.html", "utf8"),
  ]);
  assert.match(ja, /<html lang="ja">/);
  assert.match(en, /<html lang="en">/);
  for (const html of [ja, en]) {
    assert.match(html, /data-artist-detail-presentation/);
    assert.match(html, /src="\/images\/artists\/reiko-kinoshita\.png"/);
    assert.match(html, /class="artists-works-image"/);
    assert.match(html, /src="\/images\/works\/reiko-kinoshita-01\.png"/);
    assert.match(html, /artists-bio-image:not\(\.is-visible\)/);
  }
  assert.match(ja, /<p class="artists-intro__medium">陶芸<\/p>/);
  assert.match(en, /<p class="artists-intro__medium">Ceramics<\/p>/);
});
