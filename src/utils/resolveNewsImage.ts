import {
  findJournalEntry,
  journalRouteRegistry,
  type JournalIndexEntry,
} from "../content-boundaries/journal.ts";
import type { ArtistProductionEntry } from "../content-boundaries/artists-production.ts";
import type { ExhibitionProductionEntry } from "../content-boundaries/exhibitions-production.ts";

type ImageSource = {
  image: string;
  alt: string;
};

type JournalImageEntry = JournalIndexEntry & {
  data: JournalIndexEntry["data"] & {
    hero: { image: string };
    hero_alt: string;
  };
};

type NewsImageCollections = {
  exhibitions: Map<string, ExhibitionProductionEntry>;
  artists: Map<string, ArtistProductionEntry>;
  journal: JournalImageEntry[];
};

type LocaleRouteDecision =
  { kind: "available"; href: string } | { kind: "unavailable" };

export const resolveNewsImage = (
  news: { id: string; data: { link?: string } },
  collections: NewsImageCollections,
): ImageSource | null => {
  const link = news.data.link;

  if (!link || /^https?:\/\//.test(link)) return null;

  const journalReference = journalRouteRegistry.parse(link);
  if (journalReference) {
    const entry = findJournalEntry(
      collections.journal,
      journalReference.locale,
      journalReference.contentId,
    );

    if (!entry) {
      throw new Error(
        `News ${news.id} has a broken image source link: ${link}`,
      );
    }

    return {
      image: entry.data.hero.image,
      alt: entry.data.hero_alt,
    };
  }

  const match = link.match(/^\/(exhibitions|artists)\/([^/]+)\/?$/);

  if (!match) return null;

  const [, collectionName, id] = match as [
    string,
    "exhibitions" | "artists",
    string,
  ];
  const entry = collections[collectionName].get(id);

  if (!entry) {
    throw new Error(`News ${news.id} has a broken image source link: ${link}`);
  }

  return {
    image: entry.data.hero.image,
    alt: entry.data.hero_alt,
  };
};

export async function resolveLocalizedNewsImage(
  news: { id: string; data: { link?: string } },
  collections: NewsImageCollections,
  project: (pathname: string) => Promise<LocaleRouteDecision>,
): Promise<(ImageSource & { href: string }) | null> {
  const link = news.data.link;
  if (!link || /^https?:\/\//.test(link)) return null;

  const route = await project(link);
  if (route.kind === "unavailable") return null;

  const image = resolveNewsImage(news, collections);
  return image ? { ...image, href: route.href } : null;
}
