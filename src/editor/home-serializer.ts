import { stringify } from "yaml";
import {
  HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER,
  type HomeLocalized,
  type HomeShared,
} from "../content-loaders/home/schema.ts";
import type { HomeEditorDraftState } from "./home-draft-state.ts";
export type HomeSerializedFiles = {
  "index.yaml": string;
  "ja.md": string;
  "en.md": string;
};
const editable = <T>(
  source: { state: string; value?: T },
  scope: string,
): T => {
  if (source.state !== "editable") throw new Error(`${scope} unavailable`);
  return source.value!;
};
const localized = (value: HomeLocalized, marker?: string) =>
  `---\n${marker ? `# ${marker}\n` : ""}${stringify({
    about_intro: value.about_intro,
    ...(value.seo_title ? { seo_title: value.seo_title } : {}),
    ...(value.description ? { description: value.description } : {}),
  }).trimEnd()}\n---\n`;
export function serializeHomeEditorDraft(
  draft: HomeEditorDraftState,
): HomeSerializedFiles {
  return {
    "index.yaml": stringify(editable<HomeShared>(draft.shared, "shared")),
    "ja.md": localized(
      editable<HomeLocalized>(draft.locales.ja, "ja"),
      draft.copyStatus.ja === "temporary"
        ? HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER
        : undefined,
    ),
    "en.md": localized(editable<HomeLocalized>(draft.locales.en, "en")),
  };
}
