import type { Locale } from "../content-loaders/journal/contracts.ts";

export type JournalDetailPresentationModel = {
  locale: Locale;
  hero: {
    src: string;
    alt: string;
    caption?: string;
  };
  title: string;
  date: string;
  publishedDate: string;
  indexHref: string;
};

export function createJournalDetailPresentationModel(input: {
  locale: Locale;
  hero: {
    image: string;
    hero_caption?: string;
  };
  heroAlt: string;
  title: string;
  date: string;
}): JournalDetailPresentationModel {
  return {
    locale: input.locale,
    hero: {
      src: input.hero.image,
      alt: input.heroAlt,
      ...(input.hero.hero_caption ? { caption: input.hero.hero_caption } : {}),
    },
    title: input.title,
    date: input.date,
    publishedDate: new Date(input.date).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    indexHref: input.locale === "ja" ? "/journal/" : "/en/journal/",
  };
}
