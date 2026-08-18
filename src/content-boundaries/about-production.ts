import { getCollection } from "astro:content";

export async function getAboutProductionFacade() {
  const entries = await getCollection("aboutThreeFile");
  const find = (locale: "ja" | "en") =>
    entries.find((entry) => entry.data.locale === locale);
  return {
    formal: (locale: "ja" | "en") => {
      const entry = find(locale);
      return entry?.data.content_status === "approved" &&
        entry.data.hours.status === "approved"
        ? entry
        : undefined;
    },
    developmentJa: () => {
      const entry = find("ja");
      if (!entry || entry.data.content_status === "placeholder")
        throw new Error("Missing previewable JA About source");
      return entry;
    },
    enCapable: Boolean(
      find("en")?.data.content_status === "approved" &&
      find("en")?.data.hours.status === "approved",
    ),
  };
}
