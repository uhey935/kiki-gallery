import type { ExhibitionLocale } from "../content-loaders/exhibitions/schema.ts";

export type ExhibitionDetailArtist = {
  contentId: string;
  name: string;
  href: string;
};

export type ExhibitionDetailWork = {
  contentId: string;
  href: string;
  image: { src: string; alt: string };
  artist?: ExhibitionDetailArtist;
  title: string;
  year?: string | number;
  material?: string;
};

export type ExhibitionDetailPresentationModel = {
  contentId: string;
  locale: ExhibitionLocale;
  title: string;
  displayArtists: boolean;
  artists: ExhibitionDetailArtist[];
  date: string;
  hero: {
    src: string;
    alt: string;
    orientation: "portrait" | "landscape";
    caption?: string;
  };
  attendance?: string;
  openingHours?: string;
  venue?: string;
  closedDays?: string;
  summary?: string;
  works: ExhibitionDetailWork[];
  indexHref: string;
};
