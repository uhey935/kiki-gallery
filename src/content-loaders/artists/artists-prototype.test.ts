import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { getArtistsProductionFacade } from "../../content-boundaries/artists-production.ts";
import { exhibitionArtistReferenceSchema } from "../../content-schemas/exhibition.ts";
import { workArtistReferenceSchema } from "../../content-schemas/work.ts";
import { evaluateArtistCapabilities } from "./capabilities.ts";
import {
  identityEntriesFromUnits,
  localizedArtistEntryId,
  localizedEntriesFromUnits,
} from "./entry-adapter.ts";
import { createArtistsPrototypeFacade } from "./facade.ts";
import { specifyLegacyArtistMapping } from "./migration-mapping.ts";
import { loadArtistRepository } from "./repository.ts";
import { artistDetailRoute, localizedArtistRoutes } from "./route-registry.ts";

const fixtures = path.resolve("src/content-loaders/artists/fixtures");

test("JA and EN remain independent without runtime fallback", async () => {
  const units = await loadArtistRepository(fixtures);
  const facade = createArtistsPrototypeFacade(units);
  assert.equal(facade.find("valid-artist", "ja")?.data.name, "木下令子");
  assert.equal(facade.find("valid-artist", "en")?.data.name, "Reiko Kinoshita");
  assert.equal(facade.find("missing-en", "ja")?.data.name, "英語欠損");
  assert.equal(facade.find("missing-en", "en"), undefined);
});

test("missing, invalid, and placeholder EN block EN only", async () => {
  const units = await loadArtistRepository(fixtures);
  for (const contentId of ["missing-en", "invalid-en", "placeholder-en"]) {
    const unit = units.find((candidate) => candidate.contentId === contentId)!;
    const capabilities = evaluateArtistCapabilities(unit);
    assert.equal(capabilities.identity.allowed, true);
    assert.equal(capabilities.locale.ja.allowed, true);
    assert.equal(capabilities.locale.en.allowed, false);
  }
  const entries = localizedEntriesFromUnits(units);
  assert.ok(entries.some((entry) => entry.id === "ja::missing-en"));
  assert.ok(!entries.some((entry) => entry.id === "en::missing-en"));
  assert.ok(!entries.some((entry) => entry.id === "en::invalid-en"));
  assert.ok(!entries.some((entry) => entry.id === "en::placeholder-en"));
});

test("canonical Artist identity remains the external contentId", async () => {
  const units = await loadArtistRepository(fixtures);
  const identities = identityEntriesFromUnits(units);
  const localized = localizedEntriesFromUnits(units);
  assert.ok(identities.some((entry) => entry.id === "valid-artist"));
  assert.equal(
    localizedArtistEntryId("valid-artist", "ja"),
    "ja::valid-artist",
  );
  assert.ok(!identities.some((entry) => entry.id.includes("::")));
  assert.ok(localized.every((entry) => entry.contentId === entry.id.slice(4)));
});

test("existing Works and Exhibitions Artist references resolve unchanged", async () => {
  const units = await loadArtistRepository(fixtures);
  const facade = createArtistsPrototypeFacade(units);
  const workReference = workArtistReferenceSchema.parse("valid-artist");
  const exhibitionReference =
    exhibitionArtistReferenceSchema.parse("valid-artist");
  assert.deepEqual(workReference, {
    id: "valid-artist",
    collection: "artists",
  });
  assert.deepEqual(exhibitionReference, workReference);
  assert.equal(facade.resolveIdentity(workReference)?.id, "valid-artist");
  assert.equal(facade.resolveIdentity(exhibitionReference)?.id, "valid-artist");
});

test("locale routes are generated only for capable localized entries", async () => {
  const facade = createArtistsPrototypeFacade(
    await loadArtistRepository(fixtures),
  );
  const routes = localizedArtistRoutes(facade);
  assert.ok(routes.includes("/artists/valid-artist/"));
  assert.ok(routes.includes("/en/artists/valid-artist/"));
  assert.ok(routes.includes("/artists/missing-en/"));
  assert.ok(!routes.includes("/en/artists/missing-en/"));
  assert.equal(
    artistDetailRoute("valid-artist", "en"),
    "/en/artists/valid-artist/",
  );
});

test("migration mapping materializes JA name and EN name decisions", () => {
  const mapping = specifyLegacyArtistMapping({
    name: "Reiko Kinoshita",
    display_name: "木下令子",
    hero: { image: "/images/artists/reiko.png" },
    medium: ["Painting"],
    short_bio: "日本語略歴",
    biography: "日本語経歴",
    hero_alt: "日本語代替テキスト",
  });
  assert.equal(mapping.shared.sort_name, "Reiko Kinoshita");
  assert.equal(mapping.ja.name, "木下令子");
  assert.equal(mapping.en.name, "Reiko Kinoshita");
  assert.match(mapping.en.short_bio, /__TODO_EN_/);
});

test("non-empty locale body is rejected by the initial prototype", async () => {
  const units = await loadArtistRepository(fixtures);
  assert.equal(
    units.some((unit) =>
      unit.issues.some(
        (issue) => issue.ruleId === "content.locale.body.unsupported",
      ),
    ),
    false,
  );
});

test("Production exposes five canonical JA Artists and exactly the capable EN entries", async () => {
  const facade = await getArtistsProductionFacade();
  const ja = facade.forLocale("ja");
  assert.deepEqual(ja.map((entry) => entry.id).sort(), [
    "alana-wilson",
    "keisuke-matsuda",
    "reiko-kinoshita",
    "takeyoshi-mitsui",
    "yuka-mori",
  ]);
  assert.deepEqual(
    facade.forLocale("en").map((entry) => entry.id),
    ["keisuke-matsuda", "takeyoshi-mitsui"],
  );
  assert.ok(ja.every((entry) => !entry.id.includes("::")));
  assert.equal(
    facade.find("reiko-kinoshita", "ja")?.data.display_name,
    "木下令子",
  );
  assert.equal(facade.find("reiko-kinoshita", "en"), undefined);
});
