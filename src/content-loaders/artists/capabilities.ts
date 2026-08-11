import type {
  ArtistContentIssue,
  ArtistLocale,
  LoadedArtistUnit,
} from "./contracts.ts";

export type ArtistCapability = {
  allowed: boolean;
  blockers: ArtistContentIssue[];
};

export type ArtistCapabilities = {
  identity: ArtistCapability;
  locale: Record<ArtistLocale, ArtistCapability>;
};

const result = (blockers: ArtistContentIssue[]): ArtistCapability => ({
  allowed: blockers.length === 0,
  blockers,
});

export function evaluateArtistCapabilities(
  unit: LoadedArtistUnit,
): ArtistCapabilities {
  const identityBlockers = unit.issues.filter(
    (item) =>
      item.severity === "error" &&
      item.locale === undefined &&
      ["parse", "structure", "unit-integrity"].includes(item.category),
  );
  const localeBlockers = (locale: ArtistLocale) =>
    unit.issues.filter(
      (item) =>
        item.severity === "error" &&
        (item.locale === undefined || item.locale === locale),
    );
  return {
    identity: result(identityBlockers),
    locale: {
      ja: result(localeBlockers("ja")),
      en: result(localeBlockers("en")),
    },
  };
}
