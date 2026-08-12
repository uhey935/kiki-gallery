import { getCollection } from "astro:content";

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
  return {
    formal: (locale: "ja" | "en") => {
      const entry = find(locale);
      return entry?.data.copyStatus === "approved" ? entry : undefined;
    },
    developmentJa: () => {
      const entry = find("ja");
      if (!entry) throw new Error("Missing structurally valid JA Home source");
      return entry;
    },
    enCapable: false as const,
  };
}
