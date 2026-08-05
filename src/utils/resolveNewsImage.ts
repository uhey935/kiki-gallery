import type { CollectionEntry } from "astro:content";

type ImageSource = {
  image: string;
  alt: string;
};

type NewsImageCollections = {
  exhibitions: Map<string, CollectionEntry<"exhibitions">>;
  artists: Map<string, CollectionEntry<"artists">>;
  journal: Map<string, CollectionEntry<"journal">>;
};

export const resolveNewsImage = (
  news: CollectionEntry<"news">,
  collections: NewsImageCollections,
): ImageSource | null => {
  const link = news.data.link;

  if (!link || /^https?:\/\//.test(link)) return null;

  const match = link.match(/^\/(exhibitions|artists|journal)\/([^/]+)\/?$/);

  if (!match) return null;

  const [, collectionName, id] = match as [
    string,
    keyof NewsImageCollections,
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
