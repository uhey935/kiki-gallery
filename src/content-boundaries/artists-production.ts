import path from "node:path";
import type { ArtistLocale } from "../content-loaders/artists/contracts.ts";
import { createArtistsPrototypeFacade } from "../content-loaders/artists/facade.ts";
import { loadArtistRepository } from "../content-loaders/artists/repository.ts";

export type ArtistProductionEntry = {
  id: string;
  collection: "artists";
  contentId: string;
  locale: ArtistLocale;
  data: {
    sort_name: string;
    name: string;
    display_name?: string;
    hero: { image: string };
    hero_alt: string;
    medium: string[];
    medium_label: string;
    works_layout?: Array<{
      layout: "single-a" | "single-b" | "double-a" | "double-b";
      works: Array<{ id: string; collection: "works" }>;
    }>;
    short_bio: string;
    biography?: string;
    seo_title?: string;
    description?: string;
  };
};

export type ArtistsProductionFacade = {
  forLocale(locale: ArtistLocale): ArtistProductionEntry[];
  find(
    contentId: string,
    locale: ArtistLocale,
  ): ArtistProductionEntry | undefined;
};

const artistsRoot = path.resolve("src/content/artists");

export async function getArtistsProductionFacade(): Promise<ArtistsProductionFacade> {
  const prototype = createArtistsPrototypeFacade(
    await loadArtistRepository(artistsRoot),
  );
  const adapt = (
    locale: ArtistLocale,
    entry: NonNullable<ReturnType<typeof prototype.find>>,
  ): ArtistProductionEntry => ({
    id: entry.contentId,
    collection: "artists",
    contentId: entry.contentId,
    locale,
    data: {
      sort_name: entry.identity.sort_name,
      name: entry.identity.sort_name,
      ...(locale === "ja" ? { display_name: entry.data.name } : {}),
      hero: entry.identity.hero,
      hero_alt: entry.data.hero_alt,
      medium: entry.identity.medium,
      medium_label: entry.data.medium_label,
      ...(entry.identity.works_layout
        ? {
            works_layout: entry.identity.works_layout.map((section) => ({
              layout: section.layout,
              works: section.works.map((id) => ({
                id,
                collection: "works" as const,
              })),
            })),
          }
        : {}),
      short_bio: entry.data.short_bio,
      ...(entry.data.biography ? { biography: entry.data.biography } : {}),
      ...(entry.data.seo_title ? { seo_title: entry.data.seo_title } : {}),
      ...(entry.data.description
        ? { description: entry.data.description }
        : {}),
    },
  });
  return {
    forLocale: (locale) =>
      prototype.forLocale(locale).map((entry) => adapt(locale, entry)),
    find: (contentId, locale) => {
      const entry = prototype.find(contentId, locale);
      return entry ? adapt(locale, entry) : undefined;
    },
  };
}
