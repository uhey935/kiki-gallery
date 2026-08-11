import type {
  ArtistIdentityEntry,
  ArtistLocale,
  LoadedArtistUnit,
  LocalizedArtistEntry,
} from "./contracts.ts";
import { evaluateArtistCapabilities } from "./capabilities.ts";
import { ARTIST_LOCALES } from "./schema.ts";

export const localizedArtistEntryId = (
  contentId: string,
  locale: ArtistLocale,
) => `${locale}::${contentId}`;

export function identityEntriesFromUnits(
  units: LoadedArtistUnit[],
): ArtistIdentityEntry[] {
  return units.flatMap((unit) =>
    unit.identity.state === "valid" &&
    evaluateArtistCapabilities(unit).identity.allowed
      ? [
          {
            id: unit.contentId,
            contentId: unit.contentId,
            data: unit.identity.value,
          },
        ]
      : [],
  );
}

export function localizedEntriesFromUnits(
  units: LoadedArtistUnit[],
): LocalizedArtistEntry[] {
  const entries: LocalizedArtistEntry[] = [];
  for (const unit of units) {
    if (unit.identity.state !== "valid") continue;
    const capabilities = evaluateArtistCapabilities(unit);
    for (const locale of ARTIST_LOCALES) {
      const localized = unit.locales[locale];
      if (localized.state !== "valid" || !capabilities.locale[locale].allowed)
        continue;
      entries.push({
        id: localizedArtistEntryId(unit.contentId, locale),
        contentId: unit.contentId,
        locale,
        identity: unit.identity.value,
        data: localized.value,
      });
    }
  }
  return entries;
}
