import { getCollection } from "astro:content";
import { containsAboutPlaceholder } from "../content-loaders/about/schema.ts";
import { routeFamilyAvailable } from "./public-route-families.ts";
import {
  resolveProjectPublicRoot,
  validatePublicImages,
} from "./public-image-validation.ts";

const publicRoot = resolveProjectPublicRoot();

export async function getAboutProductionFacade() {
  const entries = await getCollection("aboutThreeFile");
  const find = (locale: "ja" | "en") =>
    entries.find((entry) => entry.data.locale === locale);
  const assetEntry = find("ja") ?? find("en");
  const assetUrls = assetEntry
    ? [
        assetEntry.data.images.hero.src,
        ...assetEntry.data.images.gallery.map(({ src }) => src),
      ]
    : [];
  const assets = await validatePublicImages(publicRoot, assetUrls, ["jpeg"]);
  const capability = (locale: "ja" | "en") => {
    const entry = find(locale);
    const issues: string[] = [];
    if (!entry) issues.push("source-unavailable");
    if (entry?.data.hours.status !== "approved") issues.push("hours-pending");
    if (entry?.data.content_status === "review") issues.push("content-review");
    if (entry?.data.content_status === "placeholder")
      issues.push("placeholder");
    if (
      entry &&
      (containsAboutPlaceholder(JSON.stringify(entry.data)) ||
        containsAboutPlaceholder(entry.body ?? ""))
    )
      issues.push("placeholder");
    if (entry && entry.data.images.gallery.length !== 4)
      issues.push("alt-invalid");
    if (assetUrls.length !== 5 || !assets.valid) issues.push("asset-invalid");
    if (!routeFamilyAvailable("about", locale))
      issues.push("route-unavailable");
    return {
      capable: issues.length === 0,
      entry,
      issues: [...new Set(issues)],
    };
  };
  return {
    capability,
    formal: (locale: "ja" | "en") => {
      const result = capability(locale);
      return result.capable ? result.entry : undefined;
    },
    developmentJa: () => {
      const entry = find("ja");
      if (!entry || entry.data.content_status === "placeholder")
        throw new Error("Missing previewable JA About source");
      return entry;
    },
    enCapable: capability("en").capable,
  };
}
