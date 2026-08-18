import type { AboutAssetAvailability, LoadedAboutUnit } from "./contracts.ts";
import type { AboutLocale } from "./schema.ts";

const allAssetsAvailable = (assets: AboutAssetAvailability) =>
  Object.values(assets).every(Boolean);

export function evaluateAboutLocale(
  unit: LoadedAboutUnit,
  locale: AboutLocale,
  assets: AboutAssetAvailability,
  routeProjects: boolean,
) {
  const structural =
    unit.shared.state === "valid" &&
    unit.locales[locale].state === "valid" &&
    !unit.issues.some(
      ({ category, locale: issueLocale }) =>
        category === "unit-integrity" ||
        (category === "structure" &&
          (issueLocale === undefined || issueLocale === locale)),
    );
  const localized = unit.locales[locale];
  const status =
    localized.state === "valid" ? localized.value.content_status : undefined;
  const previewable =
    structural &&
    allAssetsAvailable(assets) &&
    (status === "review" || status === "approved");
  const formal =
    previewable &&
    unit.shared.state === "valid" &&
    unit.shared.value.hours.status === "approved" &&
    status === "approved" &&
    routeProjects;
  return { structural, previewable, formal, status };
}

export function createAboutFacade(
  unit: LoadedAboutUnit,
  assets: AboutAssetAvailability,
) {
  return {
    issues: unit.issues,
    source: (locale: AboutLocale) => {
      if (
        unit.shared.state !== "valid" ||
        unit.locales[locale].state !== "valid"
      )
        return;
      return {
        contentId: "about" as const,
        locale,
        data: { ...unit.shared.value, ...unit.locales[locale].value },
      };
    },
    capability: (locale: AboutLocale, routeProjects = true) =>
      evaluateAboutLocale(unit, locale, assets, routeProjects),
  };
}
