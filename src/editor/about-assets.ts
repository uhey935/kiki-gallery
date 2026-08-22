import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  resolveProjectPublicRoot,
  validatePublicImages,
  type PublicImageIssue,
} from "../content-boundaries/public-image-validation.ts";
import type { AboutEditorDraftState } from "./about-draft-state.ts";

export const aboutDraftImageUrls = (draft: AboutEditorDraftState) =>
  draft.shared.state === "editable"
    ? [
        draft.shared.value.images.hero.src,
        ...draft.shared.value.images.gallery.map(({ src }) => src),
      ]
    : [];

export async function validateAboutDraftAssets(
  draft: AboutEditorDraftState,
  publicRoot = resolveProjectPublicRoot(),
): Promise<{ valid: boolean; issues: PublicImageIssue[] }> {
  const urls = aboutDraftImageUrls(draft);
  if (urls.length !== 5)
    return {
      valid: false,
      issues: [
        {
          url: "",
          filePath: publicRoot,
          code: "asset-invalid",
          message: "About requires one hero and exactly four gallery images",
        },
      ],
    };
  return validatePublicImages(publicRoot, urls, ["jpeg"]);
}

export async function discoverAboutImageAssets(
  publicRoot = resolveProjectPublicRoot(),
) {
  const directory = path.join(publicRoot, "images/about");
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const urls = entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => `/images/about/${entry.name}`)
    .sort();
  const validated = await Promise.all(
    urls.map(async (url) => ({
      url,
      result: await validatePublicImages(publicRoot, [url], ["jpeg"]),
    })),
  );
  return validated.filter(({ result }) => result.valid).map(({ url }) => url);
}
