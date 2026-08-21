export type ArtistDetailWork = {
  contentId: string;
  href: string;
  image: { src: string; alt: string };
  title: string;
  year?: string | number;
  size?: string;
  material?: string;
};

export type ArtistDetailWorkSection = {
  layout: "single-a" | "single-b" | "double-a" | "double-b";
  works: ArtistDetailWork[];
};

export type ArtistDetailExhibition = {
  contentId: string;
  href: string;
  image: { src: string; alt: string };
  title: string;
  date?: string;
  venue?: string;
};
