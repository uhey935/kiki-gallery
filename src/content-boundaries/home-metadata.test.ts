import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createHomeMetadataModel,
  HOME_FALLBACK_OG_IMAGE,
} from "../components/home-metadata.ts";
import type {
  HomeLocalized,
  HomeShared,
} from "../content-loaders/home/schema.ts";

const sections: HomeShared["sections"] = {
  artists: {
    destination: "artists",
    image: { src: "/images/home/artists-square.jpg" },
  },
  about: {
    destination: "about",
    image: { src: "/images/home/about-landscape.jpg" },
  },
};

const localized = (overrides: Partial<HomeLocalized> = {}): HomeLocalized => ({
  about_intro: "Home introduction",
  ...overrides,
});

test("Home metadata uses one optional override policy for JA and EN", () => {
  for (const locale of ["ja", "en"] as const) {
    assert.deepEqual(createHomeMetadataModel({ sections }, localized()), {
      image: HOME_FALLBACK_OG_IMAGE,
    });
    assert.deepEqual(
      createHomeMetadataModel(
        { sections },
        localized({
          seo_title: `${locale.toUpperCase()} SEO title`,
          description: `${locale.toUpperCase()} SEO description`,
        }),
      ),
      {
        title: `${locale.toUpperCase()} SEO title`,
        description: `${locale.toUpperCase()} SEO description`,
        image: HOME_FALLBACK_OG_IMAGE,
      },
    );
  }
});

test("Home OGP image prefers image hero, then video poster, then fallback", async () => {
  assert.equal(
    createHomeMetadataModel(
      {
        sections,
        home_hero: { media: { type: "image", image: "/hero.jpg" } },
      },
      localized(),
    ).image,
    "/hero.jpg",
  );
  assert.equal(
    createHomeMetadataModel(
      {
        sections,
        home_hero: {
          media: {
            type: "video",
            video: "/hero.mp4",
            poster: "/poster.jpg",
          },
        },
      },
      localized(),
    ).image,
    "/poster.jpg",
  );
  assert.equal(
    createHomeMetadataModel(
      {
        sections,
        home_hero: { media: { type: "video", video: "/hero.mp4" } },
      },
      localized(),
    ).image,
    HOME_FALLBACK_OG_IMAGE,
  );
  await access(path.resolve("public", HOME_FALLBACK_OG_IMAGE.slice(1)));
});

test("JA, EN, and unsaved Preview share Home metadata projection", async () => {
  const [ja, en, preview] = await Promise.all([
    readFile(path.resolve("src/pages/index.astro"), "utf8"),
    readFile(path.resolve("src/pages/en/[...singleton].astro"), "utf8"),
    readFile(path.resolve("src/editor/routes/home-preview.astro"), "utf8"),
  ]);

  for (const route of [ja, en, preview]) {
    assert.match(route, /createHomeMetadataModel/);
    assert.match(route, /title=\{[^}]*metadata[^}]*\.title\}/i);
    assert.match(route, /description=\{[^}]*metadata[^}]*\.description\}/i);
    assert.match(route, /image=\{[^}]*metadata[^}]*\.image\}/i);
    assert.doesNotMatch(route, /default-og\.jpg/);
  }
  assert.match(
    preview,
    /createHomeMetadataModel\(preview\.shared, preview\.localized\)/,
  );
  assert.match(preview, /robots="noindex,nofollow"/);
  assert.match(preview, /canonical=\{false\}/);
  assert.match(preview, /social=\{false\}/);
});
