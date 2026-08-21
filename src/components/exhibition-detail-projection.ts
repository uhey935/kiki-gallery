import {
  getArtistsProductionFacade,
  type ArtistProductionEntry,
} from "../content-boundaries/artists-production.ts";
import { getWorksProductionFacade } from "../content-boundaries/works-production.ts";
import { exhibitionIndexRoute } from "../content-loaders/exhibitions/route-registry.ts";
import { projectExhibitionWorks } from "../content-loaders/exhibitions/facade.ts";
import type {
  ExhibitionLocale,
  ExhibitionLocalized,
  ExhibitionShared,
} from "../content-loaders/exhibitions/schema.ts";
import { formatDateRangeJa } from "../utils/date.ts";
import {
  formatExhibitionClosedWeekdays,
  formatExhibitionOpeningHours,
} from "../utils/exhibition-schedule.ts";
import type { ExhibitionDetailPresentationModel } from "./exhibition-detail-presentation.ts";

type ProjectionInput = {
  contentId: string;
  locale: ExhibitionLocale;
  shared: ExhibitionShared;
  localized: ExhibitionLocalized;
};

const artistName = (artist: ArtistProductionEntry) =>
  artist.data.display_name ?? artist.data.name;

export async function createExhibitionDetailPresentationModel({
  contentId,
  locale,
  shared,
  localized,
}: ProjectionInput): Promise<ExhibitionDetailPresentationModel> {
  const [artistsFacade, worksFacade] = await Promise.all([
    getArtistsProductionFacade(),
    getWorksProductionFacade(),
  ]);
  const artistById = new Map(
    artistsFacade.forLocale(locale).map((artist) => [artist.id, artist]),
  );
  const artists = shared.artists.map((id) => {
    const artist = artistById.get(id);
    if (!artist)
      throw new Error(
        `Exhibition "${contentId}" references missing ${locale} Artist "${id}".`,
      );
    return {
      contentId: id,
      name: artistName(artist),
      href: locale === "ja" ? `/artists/${id}` : `/en/artists/${id}`,
    };
  });
  const presentationArtistById = new Map(
    artists.map((artist) => [artist.contentId, artist]),
  );
  const worksPolicy = projectExhibitionWorks(shared.works ?? [], locale);
  const workById = new Map(
    worksFacade.forLocale(locale).map((work) => [work.contentId, work]),
  );
  const projectedWorks = worksPolicy.visibleWorkIds.flatMap((id) => {
    const work = workById.get(id);
    if (!work) return [];
    const artist = presentationArtistById.get(work.data.artist);
    if (!artist)
      throw new Error(
        `Exhibition "${contentId}" Work "${id}" belongs to an Artist outside artists[].`,
      );
    const href = worksFacade.detailRoute(id, locale);
    if (!href) return [];
    return [
      {
        contentId: id,
        href,
        image: {
          src: work.data.images[0].src,
          alt: work.data.images[0].alt ?? work.data.title,
        },
        artist,
        title: work.data.title,
        year: work.data.year,
        material: work.data.material,
        sortName: artistById.get(work.data.artist)?.data.name ?? "",
      },
    ];
  });
  if (locale === "ja")
    projectedWorks.sort((a, b) =>
      a.sortName.localeCompare(b.sortName, "en", { sensitivity: "base" }),
    );
  const works = projectedWorks.map(({ sortName: _sortName, ...work }) => work);
  const date =
    locale === "ja"
      ? formatDateRangeJa(shared.start_date, shared.end_date)
      : `${shared.start_date} – ${shared.end_date}`;
  return {
    contentId,
    locale,
    title: localized.title,
    displayArtists: shared.display_artists !== false,
    artists,
    date,
    hero: {
      src: shared.hero.image,
      alt: localized.hero_alt,
      orientation: shared.hero.orientation,
      caption: localized.hero_caption,
    },
    attendance: localized.attendance,
    openingHours: shared.opening_hours
      ? formatExhibitionOpeningHours(shared.opening_hours)
      : undefined,
    venue: localized.venue,
    closedDays:
      shared.closed_weekdays === undefined
        ? undefined
        : formatExhibitionClosedWeekdays(shared.closed_weekdays, locale),
    summary: localized.summary,
    works,
    indexHref: exhibitionIndexRoute(locale),
  };
}
