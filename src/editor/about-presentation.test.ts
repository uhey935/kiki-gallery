import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all About surfaces share AboutView presentation", async () => {
  const [ja, en, preview, view] = await Promise.all([
    readFile("src/pages/about.astro", "utf8"),
    readFile("src/pages/en/[...singleton].astro", "utf8"),
    readFile("src/editor/routes/about-preview.astro", "utf8"),
    readFile("src/components/AboutView.astro", "utf8"),
  ]);

  for (const surface of [ja, en, preview]) assert.match(surface, /<AboutView/);
  assert.doesNotMatch(ja, /<main class="about"|about-hero-image/);
  assert.doesNotMatch(en, /about-hero-image/);
  assert.match(view, /about-hero-image/);
  assert.match(view, /requestAnimationFrame\(updateParallax\)/);
});

test("About Preview isolates locale, indexing, canonical, and social metadata", async () => {
  const [route, config, create] = await Promise.all([
    readFile("src/editor/routes/about-preview.astro", "utf8"),
    readFile("astro.config.mjs", "utf8"),
    readFile("src/editor/routes/about-preview-create.ts", "utf8"),
  ]);

  assert.match(config, /editor\/preview\/about\/\[token\]\/\[locale\]/);
  assert.match(create, /\$\{token\}\/\$\{model\.locale\}/);
  assert.match(route, /locale=\{preview\.locale\}/);
  assert.match(route, /robots="noindex,nofollow"/);
  assert.match(route, /canonical=\{false\}/);
  assert.match(route, /social=\{false\}/);
  assert.doesNotMatch(route, /contentId/);
});

test("public About routes retain localized SEO fields and fallbacks", async () => {
  const [ja, en] = await Promise.all([
    readFile("src/pages/about.astro", "utf8"),
    readFile("src/pages/en/[...singleton].astro", "utf8"),
  ]);

  for (const route of [ja, en]) {
    assert.match(route, /title=\{about\.data\.seo_title \?\? "About"\}/);
    assert.match(route, /description=\{about\.data\.description\}/);
  }
});
