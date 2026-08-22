import type {
  HomeDestinationAvailability,
  LoadedHomeUnit,
} from "./contracts.ts";
import type { HomeLocale } from "./schema.ts";

export type HomeFacadeEntry = {
  id: string;
  contentId: "home";
  locale: HomeLocale;
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
    return {
      id: `${locale}::home`,
      contentId: "home",
      locale,
      data: { ...unit.shared.value, ...localized.value },
    };
  };
  const formal = (locale: HomeLocale) => {
    const value = entry(locale);
    if (!value || !assetsValid) return;
    if (!destinations[locale].artists || !destinations[locale].about) return;
    return value;
  };
  return {
    issues: unit.issues,
    formal,
    sourceEntry: entry,
  };
}
