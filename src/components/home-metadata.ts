import type {
  HomeLocalized,
  HomeShared,
} from "../content-loaders/home/schema.ts";

export const HOME_FALLBACK_OG_IMAGE = "/images/home/fallback-hero.webp";

export type HomeMetadataModel = {
  title?: string;
  description?: string;
  image: string;
};

export function createHomeMetadataModel(
  shared: HomeShared,
  localized: HomeLocalized,
): HomeMetadataModel {
  const media = shared.home_hero?.media;
  const image =
    media?.type === "image"
      ? media.image
      : media?.type === "video" && media.poster
        ? media.poster
        : HOME_FALLBACK_OG_IMAGE;

  return {
    ...(localized.seo_title ? { title: localized.seo_title } : {}),
    ...(localized.description ? { description: localized.description } : {}),
    image,
  };
}
