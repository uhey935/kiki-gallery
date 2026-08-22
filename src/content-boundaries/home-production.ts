import { getCollection } from "astro:content";
import { projectPublicRouteIdentity } from "./locale-routes.ts";
import {
  resolveProjectPublicRoot,
  validatePublicImages,
} from "./public-image-validation.ts";

const publicRoot = resolveProjectPublicRoot();

export const projectHomeDestination = (
  destination: "artists" | "about",
  locale: "ja" | "en",
) =>
  locale === "ja"
    ? destination === "artists"
      ? "/artists/"
      : "/about/"
    : destination === "artists"
      ? "/en/artists/"
      : "/en/about/";

export async function getHomeProductionFacade() {
  const entries = await getCollection("homeThreeFile");
  const find = (locale: "ja" | "en") =>
    entries.find((entry) => entry.data.locale === locale);
  const destinationCapabilities = {
    artist: async () => true,
    exhibition: async () => false,
    work: async () => false,
    journal: async () => false,
    home: async () => false,
    about: async (locale: "ja" | "en") => {
      if (locale === "ja") return true;
      const { getAboutProductionFacade } =
        await import("./about-production.ts");
      return Boolean((await getAboutProductionFacade()).formal(locale));
    },
  };
  const capabilityResults = await Promise.all(
    (["ja", "en"] as const).map(async (locale) => {
      const entry = find(locale);
      const urls = entry
        ? [
            entry.data.sections.artists.image.src,
            entry.data.sections.about.image.src,
            ...(entry.data.home_hero?.media.type === "image"
              ? [entry.data.home_hero.media.image]
              : entry.data.home_hero?.media.poster
                ? [entry.data.home_hero.media.poster]
                : []),
          ]
        : [];
      const assets = await validatePublicImages(publicRoot, urls, [
        "jpeg",
        "png",
        "webp",
        "avif",
      ]);
      const artists = await projectPublicRouteIdentity(
        { surface: "artists-index" },
        locale,
        destinationCapabilities,
      );
      const about = await projectPublicRouteIdentity(
        { surface: "about" },
        locale,
        destinationCapabilities,
      );
      const issues: string[] = [];
      if (!entry) issues.push("source-unavailable");
      if (!assets.valid) issues.push("asset-invalid");
      if (artists.kind !== "available")
        issues.push("artists-route-unavailable");
      if (about.kind !== "available") issues.push("about-route-unavailable");
      return [locale, { capable: issues.length === 0, entry, issues }] as const;
    }),
  );
  const capabilities = Object.fromEntries(capabilityResults) as Record<
    "ja" | "en",
    (typeof capabilityResults)[number][1]
  >;
  return {
    capability: (locale: "ja" | "en") => capabilities[locale],
    formal: (locale: "ja" | "en") => {
      const result = capabilities[locale];
      return result.capable ? result.entry : undefined;
    },
    enCapable: capabilities.en.capable,
  };
}
