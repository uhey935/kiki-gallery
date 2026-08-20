import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import type {
  ArtistIdentity,
  ArtistLocale,
  ArtistLocalized,
} from "../content-loaders/artists/contracts.ts";
import {
  artistIdentitySchema,
  artistLocalizedSchema,
} from "../content-loaders/artists/schema.ts";
import {
  editorArtistSchema,
  type ArtistData,
} from "../content-schemas/artist.ts";
import type { ArtistsEditorEntryState } from "./artists-state.ts";

export type ArtistsEditorDraftSource<T> =
  | { state: "editable"; value: T; baseline?: T; raw?: string }
  | { state: "unavailable"; sourceState: "invalid" | "missing" };
export type ArtistsEditorDraftState = {
  contentId: string;
  shared: ArtistsEditorDraftSource<ArtistIdentity>;
  locales: Record<
    ArtistLocale,
    ArtistsEditorDraftSource<ArtistLocalized & { body: string }>
  >;
  /** JA compatibility view for the existing operator form. */
  data: ArtistData;
  body: string;
};
const clone = <T>(value: T): T => structuredClone(value);
const source = <T>(
  value: T | undefined,
  raw?: string,
): ArtistsEditorDraftSource<T> =>
  value
    ? { state: "editable", value: clone(value), baseline: clone(value), raw }
    : { state: "unavailable", sourceState: "missing" };

export const createArtistsEditorDraft = (
  entry: ArtistsEditorEntryState,
): ArtistsEditorDraftState | undefined =>
  entry.shared &&
  entry.locales.ja &&
  entry.data &&
  !entry.issues.some((issue) => issue.category === "repository-integrity")
    ? {
        contentId: entry.contentId,
        shared: source(entry.shared, entry.canonicalFiles?.["index.yaml"]),
        locales: {
          ja: source(entry.locales.ja, entry.canonicalFiles?.["ja.md"]),
          en: source(entry.locales.en, entry.canonicalFiles?.["en.md"]),
        },
        data: clone(entry.data),
        body: entry.body,
      }
    : undefined;

export function normalizeArtistsEditorDraft(
  draft: ArtistsEditorDraftState,
): ArtistsEditorDraftState {
  const next = clone(draft);
  const sharedEvidence =
    next.shared.state === "editable" ? next.shared : undefined;
  const jaEvidence =
    next.locales.ja.state === "editable" ? next.locales.ja : undefined;
  next.shared = {
    state: "editable",
    baseline: sharedEvidence?.baseline,
    raw: sharedEvidence?.raw,
    value: {
      sort_name: next.data.name,
      hero: next.data.hero,
      ...(next.data.works_layout === undefined
        ? {}
        : {
            works_layout: next.data.works_layout.map((section) => ({
              layout: section.layout,
              works: section.works.map(({ id }) => id),
            })),
          }),
      medium: next.data.medium,
    },
  };
  next.locales.ja = {
    state: "editable",
    baseline: jaEvidence?.baseline,
    raw: jaEvidence?.raw,
    value: {
      name: next.data.display_name ?? "",
      medium_label: next.data.medium_label ?? "",
      short_bio: next.data.short_bio,
      ...(next.data.biography === undefined
        ? {}
        : { biography: next.data.biography }),
      hero_alt: next.data.hero_alt,
      ...(next.data.seo_title === undefined
        ? {}
        : { seo_title: next.data.seo_title }),
      ...(next.data.description === undefined
        ? {}
        : { description: next.data.description }),
      body: next.body,
    },
  };
  return next;
}

const issue = (
  contentId: string,
  scope: string,
  fields: string[],
): ContentIssue => ({
  ruleId: "content.artist.structure",
  severity: "error",
  category: "structure",
  collection: "artists",
  contentId,
  fieldPath: fields.join(","),
  messageKey: `content.artist.${scope}.invalid`,
  recovery: { kind: "edit-field", fieldPath: fields[0] },
});

export function validateArtistsEditorDraft(input: ArtistsEditorDraftState) {
  const draft = normalizeArtistsEditorDraft(input);
  const issues: ContentIssue[] = [];
  const compatibility = editorArtistSchema.safeParse(draft.data);
  if (!compatibility.success)
    issues.push(
      ...compatibility.error.issues.map((item) =>
        issue(draft.contentId, "ja", [item.path.join(".")]),
      ),
    );
  const shared =
    draft.shared.state === "editable"
      ? artistIdentitySchema.safeParse(draft.shared.value)
      : undefined;
  if (!shared?.success)
    issues.push(
      issue(
        draft.contentId,
        "shared",
        shared
          ? shared.error.issues.map((item) => item.path.join("."))
          : ["shared"],
      ),
    );
  const preview = { ja: false, en: false };
  for (const locale of ["ja", "en"] as const) {
    const source = draft.locales[locale];
    if (source.state === "unavailable") {
      issues.push(issue(draft.contentId, locale, [locale]));
      continue;
    }
    const { body, ...localized } = source.value;
    const parsed = artistLocalizedSchema.safeParse(localized);
    if (!parsed.success || body.trim()) {
      issues.push(
        issue(
          draft.contentId,
          locale,
          parsed.success
            ? ["body"]
            : parsed.error.issues.map((item) => item.path.join(".")),
        ),
      );
      continue;
    }
    const placeholder = Object.values(localized).some(
      (value) => typeof value === "string" && value.includes("__TODO_"),
    );
    preview[locale] = !placeholder && Boolean(shared?.success);
  }
  const structural = issues.length === 0;
  return {
    issues,
    capabilities: {
      save: structural,
      preview: preview.ja,
      localePreview: preview,
      publish: structural,
    },
  };
}

export const isArtistsEditorDraftDirty = (
  initial: ArtistsEditorDraftState,
  current: ArtistsEditorDraftState,
) =>
  JSON.stringify(normalizeArtistsEditorDraft(initial)) !==
  JSON.stringify(normalizeArtistsEditorDraft(current));
