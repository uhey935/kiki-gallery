import { artistDetailRoute } from "../content-loaders/artists/route-registry.ts";
import { exhibitionDetailRoute } from "../content-loaders/exhibitions/route-registry.ts";
import { workDetailRoute } from "../content-loaders/works/route-registry.ts";
import { journalRouteRegistry } from "./journal.ts";
import {
  type PublicLocale,
  type PublicRouteFamily,
  routeFamilyAvailable,
} from "./public-route-families.ts";

export type LocaleRouteDecision =
  { kind: "available"; href: string } | { kind: "unavailable" };

export type PublicRouteIdentity =
  | { surface: "home" }
  | { surface: "artists-index" }
  | { surface: "artist-detail"; contentId: string }
  | { surface: "exhibitions-index" }
  | { surface: "exhibition-detail"; contentId: string }
  | { surface: "work-detail"; contentId: string }
  | { surface: "news-index" }
  | { surface: "journal-index" }
  | { surface: "journal-detail"; contentId: string }
  | { surface: "about" }
  | { surface: "privacy" };

type DetailSurface = Extract<
  PublicRouteIdentity,
  { contentId: string }
>["surface"];

export type LocaleRouteCapabilityProviders = {
  artist(contentId: string, locale: PublicLocale): Promise<boolean>;
  exhibition(contentId: string, locale: PublicLocale): Promise<boolean>;
  work(contentId: string, locale: PublicLocale): Promise<boolean>;
  journal(contentId: string, locale: PublicLocale): Promise<boolean>;
  home(locale: PublicLocale): Promise<boolean>;
  about(locale: PublicLocale): Promise<boolean>;
};

const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNAVAILABLE = { kind: "unavailable" } as const;

const INDEX_PATHS: Record<
  "artists-index" | "exhibitions-index" | "news-index" | "journal-index",
  Record<PublicLocale, string>
> = {
  "artists-index": { ja: "/artists/", en: "/en/artists/" },
  "exhibitions-index": { ja: "/exhibitions/", en: "/en/exhibitions/" },
  "news-index": { ja: "/news/", en: "/en/news/" },
  "journal-index": { ja: "/journal/", en: "/en/journal/" },
};

function cleanPathname(pathname: string): string {
  return pathname.split(/[?#]/, 1)[0] || "/";
}

export function localeFromPathname(pathname: string): PublicLocale {
  const clean = cleanPathname(pathname);
  return clean === "/en" || clean.startsWith("/en/") ? "en" : "ja";
}

export function parsePublicRouteIdentity(
  pathname: string,
): PublicRouteIdentity | undefined {
  const clean = cleanPathname(pathname);
  const segments = clean.split("/").filter(Boolean);
  const locale = segments[0] === "en" ? "en" : "ja";
  const route = locale === "en" ? segments.slice(1) : segments;

  if (route.length === 0) return { surface: "home" };
  if (route.length === 1) {
    switch (route[0]) {
      case "artists":
        return { surface: "artists-index" };
      case "exhibitions":
        return { surface: "exhibitions-index" };
      case "news":
        return { surface: "news-index" };
      case "journal":
        return { surface: "journal-index" };
      case "about":
        return { surface: "about" };
      case "privacy":
        return { surface: "privacy" };
      default:
        return undefined;
    }
  }
  if (route.length !== 2 || !CONTENT_ID.test(route[1])) return undefined;

  const detailSurface: Record<string, DetailSurface> = {
    artists: "artist-detail",
    exhibitions: "exhibition-detail",
    works: "work-detail",
    journal: "journal-detail",
  };
  const surface = detailSurface[route[0]];
  return surface ? { surface, contentId: route[1] } : undefined;
}

function familyForIdentity(identity: PublicRouteIdentity): PublicRouteFamily {
  return identity.surface;
}

function canonicalHref(
  identity: PublicRouteIdentity,
  locale: PublicLocale,
): string {
  switch (identity.surface) {
    case "home":
      return locale === "ja" ? "/" : "/en/";
    case "artists-index":
    case "exhibitions-index":
    case "news-index":
    case "journal-index":
      return INDEX_PATHS[identity.surface][locale];
    case "artist-detail":
      return artistDetailRoute(identity.contentId, locale);
    case "exhibition-detail":
      return exhibitionDetailRoute(identity.contentId, locale);
    case "work-detail":
      return workDetailRoute(identity.contentId, locale);
    case "journal-detail":
      return journalRouteRegistry.build({
        collection: "journal",
        contentId: identity.contentId,
        locale,
      });
    case "about":
      return locale === "ja" ? "/about/" : "/en/about/";
    case "privacy":
      return locale === "ja" ? "/privacy/" : "/en/privacy/";
  }
}

export async function projectPublicRouteIdentity(
  identity: PublicRouteIdentity,
  targetLocale: PublicLocale,
  capabilities: LocaleRouteCapabilityProviders,
): Promise<LocaleRouteDecision> {
  if ("contentId" in identity && !CONTENT_ID.test(identity.contentId)) {
    return UNAVAILABLE;
  }
  if (!routeFamilyAvailable(familyForIdentity(identity), targetLocale)) {
    return UNAVAILABLE;
  }

  let capable = true;
  switch (identity.surface) {
    case "artist-detail":
      capable = await capabilities.artist(identity.contentId, targetLocale);
      break;
    case "exhibition-detail":
      capable = await capabilities.exhibition(identity.contentId, targetLocale);
      break;
    case "work-detail":
      capable = await capabilities.work(identity.contentId, targetLocale);
      break;
    case "journal-detail":
      capable = await capabilities.journal(identity.contentId, targetLocale);
      break;
    case "home":
      capable =
        targetLocale === "ja" || (await capabilities.home(targetLocale));
      break;
    case "about":
      capable =
        targetLocale === "ja" || (await capabilities.about(targetLocale));
      break;
  }

  return capable
    ? { kind: "available", href: canonicalHref(identity, targetLocale) }
    : UNAVAILABLE;
}

const productionCapabilities: LocaleRouteCapabilityProviders = {
  artist: async (contentId, locale) => {
    const { getArtistsProductionFacade } =
      await import("./artists-production.ts");
    return Boolean(
      (await getArtistsProductionFacade()).find(contentId, locale),
    );
  },
  exhibition: async (contentId, locale) => {
    const { getExhibitionsProductionFacade } =
      await import("./exhibitions-production.ts");
    return Boolean(
      (await getExhibitionsProductionFacade()).find(contentId, locale),
    );
  },
  work: async (contentId, locale) => {
    const { getWorksProductionFacade } = await import("./works-production.ts");
    return Boolean((await getWorksProductionFacade()).find(contentId, locale));
  },
  journal: async (contentId, locale) => {
    const { getJournalProductionFacade } =
      await import("./journal-production.ts");
    return (await getJournalProductionFacade())
      .forDetail(locale)
      .some((entry) => entry.data.contentId === contentId);
  },
  home: async (locale) => {
    const { getHomeProductionFacade } = await import("./home-production.ts");
    return Boolean((await getHomeProductionFacade()).formal(locale));
  },
  about: async (locale) => {
    const { getAboutProductionFacade } = await import("./about-production.ts");
    return Boolean((await getAboutProductionFacade()).formal(locale));
  },
};

export async function projectLocaleRoute({
  pathname,
  targetLocale,
}: {
  pathname: string;
  targetLocale: PublicLocale;
}): Promise<LocaleRouteDecision> {
  const identity = parsePublicRouteIdentity(pathname);
  return identity
    ? projectPublicRouteIdentity(identity, targetLocale, productionCapabilities)
    : UNAVAILABLE;
}
