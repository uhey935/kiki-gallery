import type { LoadedExhibitionUnit } from "./contracts.ts";
import type { ExhibitionLocale } from "./schema.ts";
export type ExhibitionEntry = {
  id: string;
  contentId: string;
  locale: ExhibitionLocale;
  data: Record<string, unknown>;
  body: string;
};
export type ArtistCapabilityResolver = (
  contentId: string,
  locale: ExhibitionLocale,
) => boolean;
export type WorksProjection = {
  mode: "ja-compatibility" | "localized" | "omit";
  visibleWorkIds: string[];
  warnings: string[];
};
export function evaluateExhibitionLocale(
  unit: LoadedExhibitionUnit,
  locale: ExhibitionLocale,
  artistCapable: ArtistCapabilityResolver,
) {
  const blockers = unit.issues.filter(
    (item) =>
      item.severity === "error" &&
      (item.locale === undefined || item.locale === locale),
  );
  if (unit.shared.state === "valid")
    for (const artist of unit.shared.value.artists)
      if (!artistCapable(artist, locale))
        blockers.push({
          ruleId: "content.exhibition.artist-capability",
          severity: "error",
          category: "dependency",
          collection: "exhibitions",
          contentId: unit.contentId,
          locale,
          messageKey: `Artist ${artist} is not ${locale}-capable`,
        });
  return { allowed: blockers.length === 0, blockers };
}
export function createExhibitionsFacade(
  units: LoadedExhibitionUnit[],
  artistCapable: ArtistCapabilityResolver,
) {
  const entry = (
    unit: LoadedExhibitionUnit,
    locale: ExhibitionLocale,
  ): ExhibitionEntry | undefined => {
    if (
      !evaluateExhibitionLocale(unit, locale, artistCapable).allowed ||
      unit.shared.state !== "valid" ||
      unit.locales[locale].state !== "valid"
    )
      return;
    const localized = unit.locales[locale];
    if (localized.state !== "valid") return;
    return {
      id: `${locale}::${unit.contentId}`,
      contentId: unit.contentId,
      locale,
      data: { ...unit.shared.value, ...localized.value },
      body: localized.body ?? "",
    };
  };
  return {
    issues: units.flatMap((unit) => unit.issues),
    forLocale: (locale: ExhibitionLocale) =>
      units.flatMap((unit) => {
        const value = entry(unit, locale);
        return value ? [value] : [];
      }),
    find: (contentId: string, locale: ExhibitionLocale) => {
      const unit = units.find((item) => item.contentId === contentId);
      return unit ? entry(unit, locale) : undefined;
    },
    worksProjection: (
      contentId: string,
      locale: ExhibitionLocale,
    ): WorksProjection => {
      const unit = units.find((item) => item.contentId === contentId);
      const ids =
        unit?.shared.state === "valid" ? (unit.shared.value.works ?? []) : [];
      return locale === "ja"
        ? { mode: "ja-compatibility", visibleWorkIds: ids, warnings: [] }
        : {
            mode: "omit",
            visibleWorkIds: [],
            warnings: ids.map(
              (id) => `Work ${id} omitted until Works EN capability exists`,
            ),
          };
    },
  };
}
