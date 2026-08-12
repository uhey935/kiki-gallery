import type {
  HomeDestinationAvailability,
  HomeIssue,
  LoadedHomeUnit,
} from "./contracts.ts";
import type { HomeLocale } from "./schema.ts";

export type HomeCapability = { allowed: boolean; blockers: HomeIssue[] };

export function evaluateHomeCapability(
  unit: LoadedHomeUnit,
  locale: HomeLocale,
  destinations: HomeDestinationAvailability,
  assetsValid: boolean,
): HomeCapability {
  const blockers = unit.issues.filter(
    ({ locale: issueLocale }) =>
      issueLocale === undefined || issueLocale === locale,
  );
  if (!assetsValid)
    blockers.push({
      category: "dependency",
      message: "required assets unavailable",
    });
  for (const destination of ["artists", "about"] as const)
    if (!destinations[locale][destination])
      blockers.push({
        category: "dependency",
        locale,
        message: `${destination} route unavailable`,
      });
  return { allowed: blockers.length === 0, blockers };
}
