import type { AboutIssue } from "../content-loaders/about/contracts.ts";
import {
  aboutLocalizedFrontmatterSchema,
  aboutSharedSchema,
  containsAboutPlaceholder,
  type AboutLocalizedFrontmatter,
  type AboutShared,
} from "../content-loaders/about/schema.ts";
import type { AboutEditorEntryState } from "./about-state.ts";

type Source<T> =
  | { state: "editable"; value: T }
  | { state: "unavailable"; sourceState: "invalid" | "missing" };
export type AboutLocaleDraft = AboutLocalizedFrontmatter & { body: string };
export type AboutEditorDraftState = {
  contentId: "about";
  shared: Source<AboutShared>;
  locales: Record<"ja" | "en", Source<AboutLocaleDraft>>;
  preimages: { "index.yaml": string; "ja.md": string; "en.md": string };
};
const source = <T>(value: { state: string; value?: T }): Source<T> =>
  value.state === "valid"
    ? { state: "editable", value: structuredClone(value.value!) }
    : {
        state: "unavailable",
        sourceState: value.state as "invalid" | "missing",
      };

export const createAboutEditorDraft = (
  entry: AboutEditorEntryState,
): AboutEditorDraftState => ({
  contentId: "about",
  shared: source(entry.shared),
  locales: {
    ja: source(entry.locales.ja),
    en: source(entry.locales.en),
  },
  preimages: {
    "index.yaml": entry.shared.state === "valid" ? entry.shared.raw : "",
    "ja.md": entry.locales.ja.state === "valid" ? entry.locales.ja.raw : "",
    "en.md": entry.locales.en.state === "valid" ? entry.locales.en.raw : "",
  },
});

export const aboutDirtyScopes = (
  a: AboutEditorDraftState,
  b: AboutEditorDraftState,
) => ({
  shared: JSON.stringify(a.shared) !== JSON.stringify(b.shared),
  ja: JSON.stringify(a.locales.ja) !== JSON.stringify(b.locales.ja),
  en: JSON.stringify(a.locales.en) !== JSON.stringify(b.locales.en),
});
export const isAboutEditorDraftDirty = (
  a: AboutEditorDraftState,
  b: AboutEditorDraftState,
) => Object.values(aboutDirtyScopes(a, b)).some(Boolean);

export function validateAboutEditorDraft(draft: AboutEditorDraftState) {
  const issues: AboutIssue[] = [];
  const sharedValid =
    draft.shared.state === "editable" &&
    aboutSharedSchema.safeParse(draft.shared.value).success;
  if (!sharedValid)
    issues.push({ category: "structure", message: "invalid shared About" });
  const localeValid = { ja: false, en: false };
  const preview = { ja: false, en: false };
  const formal = { ja: false, en: false };
  for (const locale of ["ja", "en"] as const) {
    const source = draft.locales[locale];
    if (source.state === "editable") {
      const { body, ...frontmatter } = source.value;
      localeValid[locale] =
        aboutLocalizedFrontmatterSchema.safeParse(frontmatter).success &&
        Boolean(body.trim()) &&
        (frontmatter.content_status === "placeholder" ||
          !containsAboutPlaceholder(body));
      preview[locale] =
        sharedValid &&
        localeValid[locale] &&
        ["review", "approved"].includes(frontmatter.content_status);
      formal[locale] =
        preview[locale] &&
        frontmatter.content_status === "approved" &&
        draft.shared.state === "editable" &&
        draft.shared.value.hours.status === "approved";
    }
    if (!localeValid[locale])
      issues.push({
        category: "structure",
        locale,
        message: `invalid ${locale} About`,
      });
  }
  const structural = sharedValid && localeValid.ja && localeValid.en;
  return {
    issues,
    capabilities: {
      save: structural,
      publish: structural,
      preview,
      formal,
    },
  };
}
