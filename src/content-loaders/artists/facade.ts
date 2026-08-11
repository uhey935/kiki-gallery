import type {
  ArtistIdentityEntry,
  ArtistLocale,
  LoadedArtistUnit,
  LocalizedArtistEntry,
} from "./contracts.ts";
import {
  identityEntriesFromUnits,
  localizedEntriesFromUnits,
} from "./entry-adapter.ts";

export type ArtistReferenceValue =
  string | { id: string; collection: "artists" };

export type ArtistsPrototypeFacade = {
  identities(): ArtistIdentityEntry[];
  forLocale(locale: ArtistLocale): LocalizedArtistEntry[];
  find(
    contentId: string,
    locale: ArtistLocale,
  ): LocalizedArtistEntry | undefined;
  resolveIdentity(
    reference: ArtistReferenceValue,
  ): ArtistIdentityEntry | undefined;
};

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

export function createArtistsPrototypeFacade(
  units: LoadedArtistUnit[],
): ArtistsPrototypeFacade {
  const identities = identityEntriesFromUnits(units).sort((a, b) =>
    a.data.sort_name.localeCompare(b.data.sort_name, "en", {
      sensitivity: "base",
    }),
  );
  const localized = localizedEntriesFromUnits(units);
  const identityById = new Map(identities.map((entry) => [entry.id, entry]));
  return {
    identities: () => structuredClone(identities),
    forLocale: (locale) =>
      structuredClone(localized.filter((entry) => entry.locale === locale)),
    find: (contentId, locale) =>
      cloneOptional(
        localized.find(
          (entry) => entry.contentId === contentId && entry.locale === locale,
        ),
      ),
    resolveIdentity: (reference) =>
      cloneOptional(
        identityById.get(
          typeof reference === "string" ? reference : reference.id,
        ),
      ),
  };
}
