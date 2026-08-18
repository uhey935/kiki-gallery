import { stringify } from "yaml";
import type {
  AboutLocalizedFrontmatter,
  AboutShared,
} from "../content-loaders/about/schema.ts";
import type { AboutEditorDraftState } from "./about-draft-state.ts";

export type AboutSerializedFiles = {
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
const localized = (value: AboutLocalizedFrontmatter & { body: string }) => {
  const { body, ...frontmatter } = value;
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
};
export function serializeAboutEditorDraft(
  draft: AboutEditorDraftState,
): AboutSerializedFiles {
  return {
    "index.yaml": stringify(editable<AboutShared>(draft.shared, "shared")),
    "ja.md": localized(editable(draft.locales.ja, "ja")),
    "en.md": localized(editable(draft.locales.en, "en")),
  };
}
