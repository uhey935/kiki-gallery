import type { ExhibitionLocale } from "./schema.ts";
export const exhibitionIndexRoute = (locale: ExhibitionLocale) =>
  locale === "ja" ? "/exhibitions/" : "/en/exhibitions/";
export const exhibitionDetailRoute = (
  contentId: string,
  locale: ExhibitionLocale,
) =>
  locale === "ja"
    ? `/exhibitions/${contentId}/`
    : `/en/exhibitions/${contentId}/`;
export const projectExhibitionRoute = (
  contentId: string,
  locale: ExhibitionLocale,
  capable: boolean,
) => (capable ? exhibitionDetailRoute(contentId, locale) : undefined);
