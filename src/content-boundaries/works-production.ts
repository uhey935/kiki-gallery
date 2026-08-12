import { getCollection } from "astro:content";
import type { WorkLocale } from "../content-loaders/works/schema.ts";
import { workDetailRoute } from "../content-loaders/works/route-registry.ts";
import {
  getArtistsProductionFacade,
  type ArtistProductionEntry,
} from "./artists-production.ts";

type Source = Awaited<
  ReturnType<typeof getCollection<"worksLocalized">>
>[number];
export type WorkProductionEntry = Source & {
  contentId: string;
  locale: WorkLocale;
  artist: ArtistProductionEntry;
};
const placeholder = (source: Source) =>
  /__TODO_WORK_[A-Z0-9_]*__/.test(JSON.stringify(source.data)) ||
  /__TODO_WORK_[A-Z0-9_]*__/.test(source.body ?? "");

export async function getWorksProductionFacade() {
  const [sources, artists] = await Promise.all([
    getCollection("worksLocalized"),
    getArtistsProductionFacade(),
  ]);
  const entries: WorkProductionEntry[] = [];
  for (const source of sources) {
    const locale = source.data.locale;
    if (placeholder(source)) continue;
    const artist = artists.find(source.data.artist, locale);
    if (!artist) continue;
    entries.push(
      Object.assign(source, {
        contentId: source.data.contentId,
        locale,
        artist,
      }),
    );
  }
  return {
    forLocale: (locale: WorkLocale) =>
      entries.filter((entry) => entry.locale === locale),
    find: (contentId: string, locale: WorkLocale) =>
      entries.find(
        (entry) => entry.contentId === contentId && entry.locale === locale,
      ),
    detailRoute: (contentId: string, locale: WorkLocale) =>
      entries.some(
        (entry) => entry.contentId === contentId && entry.locale === locale,
      )
        ? workDetailRoute(contentId, locale)
        : undefined,
  };
}
