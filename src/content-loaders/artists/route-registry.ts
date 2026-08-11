import type { ArtistLocale } from "./contracts.ts";
import type { ArtistsPrototypeFacade } from "./facade.ts";

export const artistIndexRoute = (locale: ArtistLocale) =>
  locale === "ja" ? "/artists/" : "/en/artists/";

export const artistDetailRoute = (contentId: string, locale: ArtistLocale) =>
  locale === "ja" ? `/artists/${contentId}/` : `/en/artists/${contentId}/`;

export function localizedArtistRoutes(facade: ArtistsPrototypeFacade) {
  return (["ja", "en"] as const).flatMap((locale) => [
    artistIndexRoute(locale),
    ...facade
      .forLocale(locale)
      .map((entry) => artistDetailRoute(entry.contentId, locale)),
  ]);
}
