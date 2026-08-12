import type { HomeIssue } from "../content-loaders/home/contracts.ts";
import {
  HOME_EN_ABOUT_INTRO_PLACEHOLDER,
  homeLocalizedSchema,
  homeSharedSchema,
  type HomeLocalized,
  type HomeShared,
} from "../content-loaders/home/schema.ts";
import type { HomeEditorEntryState } from "./home-state.ts";

type Source<T> =
  | { state: "editable"; value: T }
  | { state: "unavailable"; sourceState: "invalid" | "missing" };
export type HomeEditorDraftState = {
  contentId: "home";
  shared: Source<HomeShared>;
  locales: Record<"ja" | "en", Source<HomeLocalized>>;
  copyStatus: { ja: "temporary" | "approved"; en: "placeholder" | "approved" };
  preimages: { "index.yaml": string; "ja.md": string; "en.md": string };
};
const source = <T>(value: { state: string; value?: T }): Source<T> =>
  value.state === "valid"
    ? { state: "editable", value: structuredClone(value.value!) }
    : {
        state: "unavailable",
        sourceState: value.state as "invalid" | "missing",
      };
export const createHomeEditorDraft = (
  entry: HomeEditorEntryState,
): HomeEditorDraftState => ({
  contentId: "home",
  shared: source(entry.shared),
  locales: { ja: source(entry.locales.ja), en: source(entry.locales.en) },
  copyStatus: structuredClone(entry.copyStatus),
  preimages: {
    "index.yaml": entry.shared.state === "valid" ? entry.shared.raw : "",
    "ja.md": entry.locales.ja.state === "valid" ? entry.locales.ja.raw : "",
    "en.md": entry.locales.en.state === "valid" ? entry.locales.en.raw : "",
  },
});
export const homeDirtyScopes = (
  a: HomeEditorDraftState,
  b: HomeEditorDraftState,
) => ({
  shared: JSON.stringify(a.shared) !== JSON.stringify(b.shared),
  ja:
    JSON.stringify(a.locales.ja) !== JSON.stringify(b.locales.ja) ||
    a.copyStatus.ja !== b.copyStatus.ja,
  en:
    JSON.stringify(a.locales.en) !== JSON.stringify(b.locales.en) ||
    a.copyStatus.en !== b.copyStatus.en,
});
export const isHomeEditorDraftDirty = (
  a: HomeEditorDraftState,
  b: HomeEditorDraftState,
) => Object.values(homeDirtyScopes(a, b)).some(Boolean);

export function validateHomeEditorDraft(draft: HomeEditorDraftState) {
  const issues: HomeIssue[] = [];
  let sharedValid = draft.shared.state === "editable";
  if (draft.shared.state === "editable")
    sharedValid = homeSharedSchema.safeParse(draft.shared.value).success;
  if (!sharedValid)
    issues.push({ category: "structure", message: "invalid shared Home" });
  const localeValid = { ja: false, en: false };
  for (const locale of ["ja", "en"] as const) {
    const value = draft.locales[locale];
    localeValid[locale] =
      value.state === "editable" &&
      homeLocalizedSchema.safeParse(value.value).success;
    if (!localeValid[locale])
      issues.push({
        category: "structure",
        locale,
        message: `invalid ${locale} Home`,
      });
  }
  if (draft.copyStatus.ja === "temporary")
    issues.push({
      category: "content-quality",
      locale: "ja",
      message: "temporary JA about_intro",
    });
  if (
    draft.copyStatus.en === "placeholder" ||
    (draft.locales.en.state === "editable" &&
      draft.locales.en.value.about_intro === HOME_EN_ABOUT_INTRO_PLACEHOLDER)
  )
    issues.push({
      category: "content-quality",
      locale: "en",
      message: "unresolved EN about_intro",
    });
  const structural = sharedValid && localeValid.ja && localeValid.en;
  return {
    issues,
    capabilities: {
      save: structural,
      preview: {
        ja: structural && localeValid.ja,
        en: structural && localeValid.en && draft.copyStatus.en === "approved",
      },
      formal: {
        ja: structural && draft.copyStatus.ja === "approved",
        en: false,
      },
      publish: structural,
    },
  };
}
