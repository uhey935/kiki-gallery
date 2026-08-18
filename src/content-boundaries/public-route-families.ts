export type PublicLocale = "ja" | "en";

export type PublicRouteFamily =
  | "home"
  | "artists-index"
  | "artist-detail"
  | "exhibitions-index"
  | "exhibition-detail"
  | "work-detail"
  | "news-index"
  | "journal-index"
  | "journal-detail"
  | "about"
  | "privacy";

const PUBLIC_ROUTE_FAMILY_AVAILABILITY = {
  home: { ja: true, en: true },
  "artists-index": { ja: true, en: true },
  "artist-detail": { ja: true, en: true },
  "exhibitions-index": { ja: true, en: true },
  "exhibition-detail": { ja: true, en: true },
  "work-detail": { ja: true, en: true },
  "news-index": { ja: true, en: true },
  "journal-index": { ja: true, en: false },
  "journal-detail": { ja: true, en: false },
  about: { ja: true, en: true },
  privacy: { ja: true, en: false },
} as const satisfies Record<PublicRouteFamily, Record<PublicLocale, boolean>>;

/**
 * Reports only whether a public Astro page implementation exists.
 * Per-entry and formal content capability are separate requirements.
 */
export function routeFamilyAvailable(
  family: PublicRouteFamily,
  locale: PublicLocale,
): boolean {
  return PUBLIC_ROUTE_FAMILY_AVAILABILITY[family][locale];
}
