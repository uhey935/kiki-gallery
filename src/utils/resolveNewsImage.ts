import type { CollectionEntry } from "astro:content";
import {
  findJournalEntry,
  journalRouteRegistry,
  type JournalIndexEntry,
} from "../content-boundaries/journal.ts";

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
  exhibitions: Map<string, CollectionEntry<"exhibitions">>;
  artists: Map<string, CollectionEntry<"artists">>;
  journal: JournalImageEntry[];
};

export const resolveNewsImage = (
  news: CollectionEntry<"news">,
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
