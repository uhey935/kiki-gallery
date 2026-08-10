import assert from "node:assert/strict";
import test from "node:test";
import { createNewsProductionFacade } from "./news.ts";

const entry = (
  contentId: string,
  locale: "ja" | "en",
  options: { date?: string; show_on_home?: boolean; link?: string } = {},
) => ({
  id: `${locale}::${contentId}`,
  data: {
    contentId,
    locale,
    title: `${locale} title`,
    summary: `${locale} summary`,
    date: options.date ?? "2026-01-01",
    news_type: "general" as const,
    link: options.link,
    show_on_home: options.show_on_home ?? false,
  },
});

test("Production facade keeps JA and EN independent and sorts stably", () => {
  const entries = [
    entry("zeta", "ja"),
    entry("alpha", "ja"),
    entry("newest", "ja", { date: "2026-02-01" }),
    entry("newest", "en", { date: "2026-02-01" }),
  ];
  const production = createNewsProductionFacade({
    entries,
    issuesByContentId: new Map(
      entries.map((candidate) => [candidate.data.contentId, []]),
    ),
  });
  assert.deepEqual(
    production.forIndex("ja").map((candidate) => candidate.data.contentId),
    ["newest", "alpha", "zeta"],
  );
  assert.deepEqual(
    production.forIndex("en").map((candidate) => candidate.data.contentId),
    ["newest"],
  );
});

test("locale-scoped errors do not block a valid sibling locale", () => {
  const entries = [entry("localized", "ja"), entry("localized", "en")];
  const production = createNewsProductionFacade({
    entries,
    issuesByContentId: new Map([
      ["localized", [{ severity: "error", locale: "en" }]],
    ]),
  });
  assert.equal(production.forIndex("ja").length, 1);
  assert.equal(production.forIndex("en").length, 0);
});

test("Home output requires show_on_home and a link", () => {
  const entries = [
    entry("visible", "ja", { show_on_home: true, link: "/news/visible" }),
    entry("index-only", "ja"),
  ];
  const production = createNewsProductionFacade({
    entries,
    issuesByContentId: new Map(
      entries.map((candidate) => [candidate.data.contentId, []]),
    ),
  });
  assert.deepEqual(
    production.forHome("ja").map((candidate) => candidate.data.contentId),
    ["visible"],
  );
});

test("Production facade rejects entries without Issue ownership", () => {
  const production = createNewsProductionFacade({
    entries: [entry("unowned", "ja")],
    issuesByContentId: new Map(),
  });
  assert.throws(() => production.forIndex("ja"), /Missing News issues/);
});
