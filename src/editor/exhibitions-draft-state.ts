import type { ExhibitionIssue } from "../content-loaders/exhibitions/contracts.ts";
import { exhibitionLocalizedSchema, exhibitionSharedSchema, type ExhibitionLocale, type ExhibitionLocalized, type ExhibitionShared } from "../content-loaders/exhibitions/schema.ts";
import type { ExhibitionsEditorEntryState } from "./exhibitions-state.ts";

export type ExhibitionsEditorDraftSource<T> = { state: "editable"; value: T } | { state: "unavailable"; sourceState: "invalid" | "missing" };
export type ExhibitionsEditorDraftState = {
  contentId: string;
  shared: ExhibitionsEditorDraftSource<ExhibitionShared>;
  locales: Record<ExhibitionLocale, ExhibitionsEditorDraftSource<ExhibitionLocalized & { body: string }>>;
  /** @deprecated transitional browser projection; canonical persistence uses shared/locales. */
  data?: any;
  /** @deprecated transitional browser projection. */
  body?: string;
  sourceRaw?: string;
};
const source = <T>(value: { state: string; value?: T }): ExhibitionsEditorDraftSource<T> =>
  value.state === "valid" ? { state: "editable", value: structuredClone(value.value!) } : { state: "unavailable", sourceState: value.state as "invalid" | "missing" };
export const createExhibitionsEditorDraft = (entry: ExhibitionsEditorEntryState): ExhibitionsEditorDraftState => ({
  contentId: entry.contentId,
  shared: source(entry.shared),
  locales: { ja: source(entry.locales.ja), en: source(entry.locales.en) },
});
export const normalizeExhibitionDateInput = (value: string) => value;
export const isExhibitionsEditorDraftDirty = (a: ExhibitionsEditorDraftState, b: ExhibitionsEditorDraftState) => JSON.stringify(a) !== JSON.stringify(b);
export function validateExhibitionsEditorDraft(draft: ExhibitionsEditorDraftState) {
  const issues: ExhibitionIssue[] = [];
  const add = (locale: ExhibitionLocale | undefined, messageKey: string, field?: string) => issues.push({ ruleId: field === "placeholder" ? "content.placeholder.unresolved" : "content.exhibition.structure", severity: "error", category: field === "placeholder" ? "content-quality" : "structure", collection: "exhibitions", contentId: draft.contentId, locale, messageKey });
  if (draft.shared.state !== "editable") add(undefined, "content.shared.invalid");
  else { const result = exhibitionSharedSchema.safeParse(draft.shared.value); if (!result.success) add(undefined, result.error.issues.map(i => i.path.join(".")).join(",")); }
  const preview = { ja: true, en: true };
  for (const locale of ["ja", "en"] as const) {
    const value = draft.locales[locale];
    if (value.state !== "editable") { add(locale, "content.locale.invalid"); preview[locale] = false; continue; }
    const { body, ...localized } = value.value;
    const result = exhibitionLocalizedSchema.safeParse(localized);
    if (!result.success) { add(locale, result.error.issues.map(i => i.path.join(".")).join(",")); preview[locale] = false; }
    if (Object.values(value.value).some(candidate => typeof candidate === "string" && candidate.includes("__TODO_"))) { add(locale, "content.placeholder.unresolved", "placeholder"); preview[locale] = false; }
    void body;
  }
  const structural = draft.shared.state === "editable" && ["ja", "en"].every(locale => draft.locales[locale as ExhibitionLocale].state === "editable") && issues.every(issue => issue.category === "content-quality");
  return { issues, capabilities: { save: structural, preview, publish: structural && preview.ja } };
}
