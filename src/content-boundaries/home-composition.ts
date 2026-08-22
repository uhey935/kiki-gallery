import type {
  HomeLocale,
  HomeLocalized,
  HomeShared,
} from "../content-loaders/home/schema.ts";
import {
  getArtistDisplayName,
  getExhibitionDisplayTitle,
  resolveExhibitionArtists,
} from "../utils/exhibitionDisplay.ts";
import { getExhibitionStatus } from "../utils/exhibitionStatus.ts";
import { resolveLocalizedNewsImage } from "../utils/resolveNewsImage.ts";
import { getArtistsProductionFacade } from "./artists-production.ts";
import { getExhibitionsProductionFacade } from "./exhibitions-production.ts";
import { journalRouteRegistry } from "./journal.ts";
import { getJournalProductionFacade } from "./journal-production.ts";
import { projectLocaleRoute } from "./locale-routes.ts";
import { getNewsProductionFacade } from "./news-production.ts";
import { selectHomeStories } from "./home-story-selection.ts";

export type HomePresentationModel = {
  hero?: NonNullable<HomeShared["home_hero"]>["media"];
  artists: { href: string; image: string };
  about: { href: string; image: string; intro: string };
  exhibitions: Array<{
    href: string;
    image: string;
    alt: string;
    status: string;
    artists: string[];
    title: string;
    start: string;
    end: string;
  }>;
  exhibitionsHref?: string;
  stories: Array<{
    href: string;
    image: string;
    alt: string;
    type?: string;
    title: string;
  }>;
  storiesHref?: string;
};

const project = (pathname: string, locale: HomeLocale) =>
  projectLocaleRoute({ pathname, targetLocale: locale });

export async function createHomePresentationModel(
  locale: HomeLocale,
  shared: HomeShared,
  localized: HomeLocalized,
): Promise<HomePresentationModel> {
  const [artistsFacade, exhibitionsFacade, journalFacade, newsFacade] =
    await Promise.all([
      getArtistsProductionFacade(),
      getExhibitionsProductionFacade(),
      getJournalProductionFacade(),
      getNewsProductionFacade(),
    ]);
  const artistEntries = artistsFacade.forLocale(locale);
  const artistMap = new Map(artistEntries.map((entry) => [entry.id, entry]));
  const exhibitionEntries = exhibitionsFacade.forLocale(locale);
  const exhibitions = exhibitionsFacade.forHome(locale, 2).map((entry) => {
    const resolvedArtists = resolveExhibitionArtists(entry, artistMap);
    return {
      href: exhibitionsFacade.detailRoute(entry.id, locale)!,
      image: entry.data.hero.image,
      alt: entry.data.hero_alt,
      status: getExhibitionStatus(entry.data.start_date, entry.data.end_date),
      artists:
        entry.data.display_artists === false
          ? []
          : resolvedArtists.map(getArtistDisplayName),
      title: getExhibitionDisplayTitle(entry, resolvedArtists),
      start: entry.data.start_date.toISOString().slice(0, 10),
      end: entry.data.end_date.toISOString().slice(0, 10),
    };
  });
  const imageCollections = {
    exhibitions: new Map(exhibitionEntries.map((entry) => [entry.id, entry])),
    artists: artistMap,
    journal: journalFacade.forNewsIntegration(locale),
  };
  const newsStories = (
    await Promise.all(
      newsFacade.forHome(locale).map(async (entry) => {
        const resolved = await resolveLocalizedNewsImage(
          entry,
          imageCollections,
          (pathname) => project(pathname, locale),
        );
        return resolved
          ? {
              date: entry.data.date,
              href: resolved.href,
              image: resolved.image,
              alt: resolved.alt,
              type: entry.data.news_type,
              title: entry.data.title,
            }
          : undefined;
      }),
    )
  ).filter((story) => story !== undefined);
  const journalStories = (
    await Promise.all(
      journalFacade.forHomeStories(locale).map(async (entry) => {
        const canonical = journalRouteRegistry.build({
          collection: "journal",
          contentId: entry.data.contentId,
          locale: "ja",
        });
        const route = await project(canonical, locale);
        return route.kind === "available"
          ? {
              date: entry.data.date,
              href: route.href,
              image: entry.data.hero.image,
              alt: entry.data.hero_alt,
              type: entry.data.category,
              title: entry.data.title,
            }
          : undefined;
      }),
    )
  ).filter((story) => story !== undefined);
  const stories = selectHomeStories(newsStories, journalStories);
  const [artistsRoute, aboutRoute, exhibitionsRoute, journalRoute, newsRoute] =
    await Promise.all([
      project("/artists/", locale),
      project("/about/", locale),
      project("/exhibitions/", locale),
      project("/journal/", locale),
      project("/news/", locale),
    ]);
  if (artistsRoute.kind !== "available" || aboutRoute.kind !== "available")
    throw new Error(`Home ${locale} destinations became unavailable`);
  return {
    ...(shared.home_hero ? { hero: shared.home_hero.media } : {}),
    artists: {
      href: artistsRoute.href,
      image: shared.sections.artists.image.src,
    },
    about: {
      href: aboutRoute.href,
      image: shared.sections.about.image.src,
      intro: localized.about_intro,
    },
    exhibitions,
    ...(exhibitionsRoute.kind === "available"
      ? { exhibitionsHref: exhibitionsRoute.href }
      : {}),
    stories,
    ...(journalRoute.kind === "available"
      ? { storiesHref: journalRoute.href }
      : newsRoute.kind === "available"
        ? { storiesHref: newsRoute.href }
        : {}),
  };
}
