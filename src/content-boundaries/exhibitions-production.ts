import { getCollection } from "astro:content";
import type { ExhibitionLocale } from "../content-loaders/exhibitions/schema.ts";
import {
  exhibitionDetailRoute,
  exhibitionIndexRoute,
} from "../content-loaders/exhibitions/route-registry.ts";
import { getExhibitionStatus } from "../utils/exhibitionStatus.ts";
import { getArtistsProductionFacade } from "./artists-production.ts";
import {
  getWorksProductionFacade,
  type WorkProductionEntry,
} from "./works-production.ts";

type SourceEntry = Awaited<
  ReturnType<typeof getCollection<"exhibitionsThreeFile">>
>[number];

export type ExhibitionProductionEntry = {
  id: string;
  collection: "exhibitionsThreeFile";
  contentId: string;
  locale: ExhibitionLocale;
  source: SourceEntry;
  data: {
    contentId: string;
    locale: ExhibitionLocale;
    artists: Array<{ id: string; collection: "artists" }>;
    works?: Array<{ id: string; collection: "works" }>;
    start_date: Date;
    end_date: Date;
    display_artists?: boolean;
    opening_hours?: { opens: string; closes: string };
    closed_weekdays?: Array<
      "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
    >;
    hero: {
      image: string;
      orientation: "portrait" | "landscape";
      position?: "top" | "center" | "bottom" | "left" | "right";
      treatment?: "default" | "contain" | "cover";
      hero_caption?: string;
    };
    title: string;
    summary?: string;
    venue?: string;
    attendance?: string;
    hero_alt: string;
    seo_title?: string;
    description?: string;
  };
};

const asDate = (value: string) => new Date(value);

const adapt = (source: SourceEntry): ExhibitionProductionEntry => ({
  id: source.data.contentId,
  collection: "exhibitionsThreeFile",
  contentId: source.data.contentId,
  locale: source.data.locale,
  source,
  data: {
    contentId: source.data.contentId,
    locale: source.data.locale,
    artists: source.data.artists.map((id) => ({
      id,
      collection: "artists" as const,
    })),
    ...(source.data.works
      ? {
          works: source.data.works.map((id) => ({
            id,
            collection: "works" as const,
          })),
        }
      : {}),
    start_date: asDate(source.data.start_date),
    end_date: asDate(source.data.end_date),
    ...(source.data.display_artists === undefined
      ? {}
      : { display_artists: source.data.display_artists }),
    ...(source.data.opening_hours
      ? { opening_hours: source.data.opening_hours }
      : {}),
    ...(source.data.closed_weekdays === undefined
      ? {}
      : { closed_weekdays: source.data.closed_weekdays }),
    hero: {
      ...source.data.hero,
      ...(source.data.hero_caption
        ? { hero_caption: source.data.hero_caption }
        : {}),
    },
    title: source.data.title,
    ...(source.data.summary ? { summary: source.data.summary } : {}),
    ...(source.data.venue ? { venue: source.data.venue } : {}),
    ...(source.data.attendance ? { attendance: source.data.attendance } : {}),
    hero_alt: source.data.hero_alt,
    ...(source.data.seo_title ? { seo_title: source.data.seo_title } : {}),
    ...(source.data.description
      ? { description: source.data.description }
      : {}),
  },
});

export type ExhibitionsProductionFacade = ReturnType<
  typeof createExhibitionsProductionFacade
>;

export function createExhibitionsProductionFacade(
  entries: ExhibitionProductionEntry[],
) {
  const byLocale = (locale: ExhibitionLocale) =>
    entries.filter((entry) => entry.locale === locale);
  return {
    forLocale: byLocale,
    find: (contentId: string, locale: ExhibitionLocale) =>
      entries.find(
        (entry) => entry.contentId === contentId && entry.locale === locale,
      ),
    forArtist: (contentId: string, locale: ExhibitionLocale) =>
      byLocale(locale)
        .filter((entry) =>
          entry.data.artists.some((artist) => artist.id === contentId),
        )
        .sort(
          (a, b) => b.data.start_date.getTime() - a.data.start_date.getTime(),
        ),
    forHome: (locale: ExhibitionLocale, limit = 2) => {
      const entriesWithStatus = byLocale(locale).map((entry) => ({
        entry,
        status: getExhibitionStatus(entry.data.start_date, entry.data.end_date),
      }));
      return (["ongoing", "upcoming", "past"] as const)
        .flatMap((status) =>
          entriesWithStatus
            .filter((item) => item.status === status)
            .sort(
              (a, b) =>
                b.entry.data.start_date.getTime() -
                a.entry.data.start_date.getTime(),
            ),
        )
        .slice(0, limit)
        .map((item) => item.entry);
    },
    detailRoute: (contentId: string, locale: ExhibitionLocale) =>
      entries.some(
        (entry) => entry.contentId === contentId && entry.locale === locale,
      )
        ? exhibitionDetailRoute(contentId, locale)
        : undefined,
    indexRoute: exhibitionIndexRoute,
    projectNewsLink: (link: string | undefined, locale: ExhibitionLocale) => {
      if (!link) return null;
      const match = /^\/exhibitions\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(link);
      if (!match) return link;
      return entries.some(
        (entry) => entry.contentId === match[1] && entry.locale === locale,
      )
        ? exhibitionDetailRoute(match[1], locale)
        : null;
    },
    worksProjection: async (
      entry: ExhibitionProductionEntry,
      locale: ExhibitionLocale,
    ) => {
      const works = await getWorksProductionFacade();
      const byId = new Map(
        works.forLocale(locale).map((work) => [work.contentId, work]),
      );
      return (entry.data.works ?? []).flatMap(
        (reference): WorkProductionEntry[] => {
          const work = byId.get(reference.id);
          if (!work) return [];
          if (
            !entry.data.artists.some((artist) => artist.id === work.data.artist)
          )
            throw new Error(
              `Exhibition "${entry.contentId}" Work "${reference.id}" belongs to an Artist outside artists[].`,
            );
          return [work];
        },
      );
    },
  };
}

export async function getExhibitionsProductionFacade() {
  const [sources, artists] = await Promise.all([
    getCollection("exhibitionsThreeFile"),
    getArtistsProductionFacade(),
  ]);
  const artistIds = new Set(
    (["ja", "en"] as const).flatMap((locale) =>
      artists.forLocale(locale).map((artist) => `${locale}:${artist.id}`),
    ),
  );
  const worksFacade = await getWorksProductionFacade();
  const entries = sources.map(adapt);
  for (const entry of entries) {
    for (const artist of entry.data.artists)
      if (!artistIds.has(`${entry.locale}:${artist.id}`))
        throw new Error(
          `Exhibition "${entry.contentId}" has a non-capable ${entry.locale} Artist "${artist.id}".`,
        );
    for (const workReference of entry.data.works ?? []) {
      const work = worksFacade.find(workReference.id, entry.locale);
      if (!work) continue;
      if (!entry.data.artists.some((artist) => artist.id === work.data.artist))
        throw new Error(
          `Exhibition "${entry.contentId}" Work "${workReference.id}" belongs to an Artist outside artists[].`,
        );
    }
  }
  return createExhibitionsProductionFacade(entries);
}
