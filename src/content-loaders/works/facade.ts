import type { LoadedWorkUnit } from "./repository.ts";
import { localizedWorkEntryId } from "./repository.ts";
import { WORK_LOCALES, type WorkLocale } from "./schema.ts";

export type WorkArtistResolution = {
  contentId: string;
  name: string;
  route: string;
};
export type WorkArtistResolver = (
  artistId: string,
  locale: WorkLocale,
) => WorkArtistResolution | undefined;
export type LocalizedWork = {
  id: string;
  contentId: string;
  locale: WorkLocale;
  artist: WorkArtistResolution;
  images: Array<{ src: string; alt: string }>;
  body: string;
  title: string;
  material?: string;
  size?: string;
  seo_title?: string;
  description?: string;
  year?: number;
  orientation?: "landscape";
  inquiry: unknown;
};

export function createWorksPrototypeFacade(
  units: LoadedWorkUnit[],
  resolveArtist: WorkArtistResolver,
) {
  const entries: LocalizedWork[] = [];
  for (const unit of units)
    if (unit.shared.state === "valid")
      for (const locale of WORK_LOCALES) {
        const localized = unit.locales[locale];
        const artist = resolveArtist(unit.shared.value.artist, locale);
        const blocked = unit.issues.some(
          (issue) => issue.locale === undefined || issue.locale === locale,
        );
        if (localized.state !== "valid" || !artist || blocked) continue;
        const {
          artist: _artistId,
          images: sharedImages,
          ...sharedData
        } = unit.shared.value;
        entries.push({
          id: localizedWorkEntryId(unit.contentId, locale),
          contentId: unit.contentId,
          locale,
          artist,
          ...sharedData,
          ...localized.value,
          body: localized.body ?? "",
          images: sharedImages.map((image, i) => ({
            src: image.src,
            alt: localized.value.images[i].alt,
          })),
        });
      }
  return {
    forLocale: (locale: WorkLocale) =>
      structuredClone(entries.filter((e) => e.locale === locale)),
    find: (contentId: string, locale: WorkLocale) =>
      structuredClone(
        entries.find((e) => e.contentId === contentId && e.locale === locale),
      ),
  };
}
