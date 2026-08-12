import type {
  HomeDestinationAvailability,
  LoadedHomeUnit,
} from "./contracts.ts";
import {
  HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER,
  type HomeLocale,
} from "./schema.ts";

export type HomeCopyStatus = "approved" | "temporary" | "placeholder";

export type HomeFacadeEntry = {
  id: string;
  contentId: "home";
  locale: HomeLocale;
  copyStatus: HomeCopyStatus;
  data: Record<string, unknown>;
};

export function createHomeFacade(
  unit: LoadedHomeUnit,
  destinations: HomeDestinationAvailability,
  assetsValid: boolean,
) {
  const entry = (locale: HomeLocale): HomeFacadeEntry | undefined => {
    if (unit.shared.state !== "valid" || unit.locales[locale].state !== "valid")
      return;
    const localized = unit.locales[locale];
    if (localized.state !== "valid") return;
    const copyStatus: HomeCopyStatus = localized.raw.includes(
      HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER,
    )
      ? "temporary"
      : unit.issues.some(
            (item) =>
              item.locale === locale && item.category === "content-quality",
          )
        ? "placeholder"
        : "approved";
    return {
      id: `${locale}::home`,
      contentId: "home",
      locale,
      copyStatus,
      data: { ...unit.shared.value, ...localized.value },
    };
  };
  const formal = (locale: HomeLocale) => {
    const value = entry(locale);
    if (!value || value.copyStatus !== "approved" || !assetsValid) return;
    if (!destinations[locale].artists || !destinations[locale].about) return;
    return value;
  };
  return {
    issues: unit.issues,
    formal,
    developmentJa: () => {
      const value = entry("ja");
      if (!value || !assetsValid) return;
      if (!destinations.ja.artists || !destinations.ja.about) return;
      return value;
    },
    sourceEntry: entry,
  };
}
