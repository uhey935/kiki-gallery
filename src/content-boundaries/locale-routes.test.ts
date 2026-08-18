import assert from "node:assert/strict";
import test from "node:test";
import {
  localeFromPathname,
  parsePublicRouteIdentity,
  projectPublicRouteIdentity,
  type LocaleRouteCapabilityProviders,
  type PublicRouteIdentity,
} from "./locale-routes.ts";

const capableIds = new Set(["capable-entry"]);
const capabilities: LocaleRouteCapabilityProviders = {
  artist: async (id) => capableIds.has(id),
  exhibition: async (id) => capableIds.has(id),
  work: async (id) => capableIds.has(id),
  journal: async () => true,
  home: async () => true,
  about: async () => true,
};

test("locale detection recognizes only the complete EN path segment", () => {
  assert.equal(localeFromPathname("/en/"), "en");
  assert.equal(localeFromPathname("/en/artists/"), "en");
  assert.equal(localeFromPathname("/enough/"), "ja");
  assert.equal(localeFromPathname("/energy/"), "ja");
});

test("public path parsing accepts optional trailing slashes and strips query/hash", () => {
  assert.deepEqual(parsePublicRouteIdentity("/"), { surface: "home" });
  assert.deepEqual(parsePublicRouteIdentity("/en/?from=header#top"), {
    surface: "home",
  });
  assert.deepEqual(parsePublicRouteIdentity("/artists"), {
    surface: "artists-index",
  });
  assert.deepEqual(parsePublicRouteIdentity("/artists/"), {
    surface: "artists-index",
  });
  assert.deepEqual(parsePublicRouteIdentity("/en/artists/capable-entry/"), {
    surface: "artist-detail",
    contentId: "capable-entry",
  });
});

test("public path parsing rejects non-public, malformed, and unknown identities", () => {
  for (const pathname of [
    "/enough/",
    "/artists/Bad-ID/",
    "/artists/ja::entry/",
    "/artists/en::entry/",
    "/artists/entry/extra/",
    "/works/",
    "/news/entry/",
    "/editor/",
    "/editor/api/news/entry/",
    "/editor/preview/works/token/entry/",
    "/api/content/",
    "/images/artists/example.jpg",
    "/favicon.svg",
    "/404/",
    "/unknown/",
  ]) {
    assert.equal(parsePublicRouteIdentity(pathname), undefined, pathname);
  }
});

async function project(identity: PublicRouteIdentity, locale: "ja" | "en") {
  return projectPublicRouteIdentity(identity, locale, capabilities);
}

test("implemented indexes project in both directions without entry counts", async () => {
  for (const [surface, ja, en] of [
    ["artists-index", "/artists/", "/en/artists/"],
    ["exhibitions-index", "/exhibitions/", "/en/exhibitions/"],
    ["news-index", "/news/", "/en/news/"],
  ] as const) {
    assert.deepEqual(await project({ surface }, "ja"), {
      kind: "available",
      href: ja,
    });
    assert.deepEqual(await project({ surface }, "en"), {
      kind: "available",
      href: en,
    });
  }
});

test("detail projection preserves capable canonical Content IDs without fallback", async () => {
  for (const [surface, collection] of [
    ["artist-detail", "artists"],
    ["exhibition-detail", "exhibitions"],
    ["work-detail", "works"],
  ] as const) {
    assert.deepEqual(
      await project({ surface, contentId: "capable-entry" }, "en"),
      { kind: "available", href: `/en/${collection}/capable-entry/` },
    );
    assert.deepEqual(
      await project({ surface, contentId: "capable-entry" }, "ja"),
      { kind: "available", href: `/${collection}/capable-entry/` },
    );
    assert.deepEqual(
      await project({ surface, contentId: "missing-entry" }, "en"),
      { kind: "unavailable" },
    );
  }
});

test("direct identity projection cannot leak internal localized IDs", async () => {
  assert.deepEqual(
    await project(
      { surface: "artist-detail", contentId: "en::capable-entry" },
      "en",
    ),
    { kind: "unavailable" },
  );
});

test("unimplemented EN families remain unavailable despite content capability", async () => {
  for (const identity of [
    { surface: "home" },
    { surface: "about" },
    { surface: "privacy" },
    { surface: "journal-index" },
    { surface: "journal-detail", contentId: "capable-entry" },
  ] as PublicRouteIdentity[]) {
    assert.deepEqual(await project(identity, "en"), { kind: "unavailable" });
  }
});

test("intentional current JA singleton/static routes remain valid targets", async () => {
  assert.deepEqual(await project({ surface: "home" }, "ja"), {
    kind: "available",
    href: "/",
  });
  assert.deepEqual(await project({ surface: "about" }, "ja"), {
    kind: "available",
    href: "/about/",
  });
  assert.deepEqual(await project({ surface: "privacy" }, "ja"), {
    kind: "available",
    href: "/privacy/",
  });
});
