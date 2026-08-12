import type { WorkLocale } from "./schema.ts";
import type { createWorksPrototypeFacade } from "./facade.ts";
export const workDetailRoute = (contentId: string, locale: WorkLocale) =>
  locale === "ja" ? `/works/${contentId}/` : `/en/works/${contentId}/`;
export function localizedWorkRoutes(
  facade: ReturnType<typeof createWorksPrototypeFacade>,
) {
  return (["ja", "en"] as const).flatMap((locale) =>
    facade
      .forLocale(locale)
      .map((entry) => workDetailRoute(entry.contentId, locale)),
  );
}
