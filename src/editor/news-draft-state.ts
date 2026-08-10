import { evaluateNewsCapabilities } from "../content-loaders/news/capabilities.ts";
import type {
  LoadedNewsUnit,
  NewsContentIssue,
  NewsLocale,
  NewsLocalized,
  NewsShared,
  NewsSourceState,
} from "../content-loaders/news/contracts.ts";
import {
  newsLocalizedSchema,
  newsSharedSchema,
} from "../content-loaders/news/schema.ts";
import { newsSchema, type NewsData } from "../content-schemas/news.ts";
import type { NewsEditorEntryState } from "./news-state.ts";

export type NewsEditorDraftSource<T> =
  | { state: "editable"; value: T }
  | { state: "unavailable"; sourceState: "invalid" | "missing" };

export type NewsEditorDraftState = {
  contentId: string;
  sourceModel: "legacy" | "three-file";
  shared: NewsEditorDraftSource<NewsShared>;
  locales: Record<
    NewsLocale,
    NewsEditorDraftSource<NewsLocalized & { body: string }>
  >;
  /** Compatibility view for the legacy write APIs. */
  data: NewsData;
  /** Legacy write preimage retained until transaction migration. */
  sourceRaw: string;
};

const clone = <T>(value: T): T => structuredClone(value);

function source<T>(value: T | undefined): NewsEditorDraftSource<T> {
  return value
    ? { state: "editable", value: clone(value) }
    : { state: "unavailable", sourceState: "missing" };
}

function compatibilityData(
  shared: NewsShared,
  ja: NewsLocalized & { body?: string },
): NewsData {
  const { body: _body, ...localized } = ja;
  return newsSchema.parse({ ...shared, ...localized });
}

export const createNewsEditorDraft = (
  entry: NewsEditorEntryState,
): NewsEditorDraftState | undefined => {
  if (!entry.shared || !entry.locales.ja || !entry.data) return undefined;
  return {
    contentId: entry.contentId,
    sourceModel: entry.sourceModel,
    shared: source(entry.shared),
    locales: {
      ja: source(entry.locales.ja),
      en: source(entry.locales.en),
    },
    data: compatibilityData(entry.shared, entry.locales.ja),
    sourceRaw:
      entry.sourceModel === "legacy" ? entry.raw : (entry.legacy?.raw ?? ""),
  };
};

export function updateNewsEditorDraft(
  draft: NewsEditorDraftState,
  update: (next: NewsEditorDraftState) => void,
): NewsEditorDraftState {
  const next = clone(draft);
  update(next);
  if (next.shared.state === "editable" && next.locales.ja.state === "editable")
    next.data = compatibilityData(next.shared.value, next.locales.ja.value);
  return next;
}

function unavailable<T>(state: "invalid" | "missing"): NewsSourceState<T> {
  return state === "invalid"
    ? { state: "invalid", raw: "" }
    : { state: "missing" };
}

function validationIssue(
  contentId: string,
  scope: "shared" | NewsLocale,
  fields: string[],
): NewsContentIssue {
  const locale = scope === "shared" ? undefined : scope;
  return {
    ruleId:
      scope === "shared"
        ? "content.shared.structure"
        : "content.locale.structure",
    severity: "error",
    category: "structure",
    collection: "news",
    contentId,
    locale,
    messageKey:
      scope === "shared" ? "content.shared.invalid" : "content.locale.invalid",
    params: { fields: fields.join(",") },
    recovery: { kind: "edit-field" },
  };
}

function unavailableIssue(
  contentId: string,
  locale: NewsLocale,
  state: "invalid" | "missing",
): NewsContentIssue {
  return {
    ruleId:
      state === "missing"
        ? "content.locale.missing"
        : "content.locale.structure",
    severity: "error",
    category: state === "missing" ? "unit-integrity" : "structure",
    collection: "news",
    contentId,
    locale,
    messageKey:
      state === "missing" ? "content.locale.missing" : "content.locale.invalid",
    recovery: { kind: "edit-source" },
  };
}

export function validateNewsEditorDraft(draft: NewsEditorDraftState) {
  const issues: NewsContentIssue[] = [];
  let shared: LoadedNewsUnit["shared"];
  if (draft.shared.state === "editable") {
    const result = newsSharedSchema.safeParse(draft.shared.value);
    if (result.success)
      shared = { state: "valid", raw: "", value: result.data };
    else {
      issues.push(
        validationIssue(
          draft.contentId,
          "shared",
          result.error.issues
            .map((item) => item.path.join("."))
            .filter(Boolean),
        ),
      );
      shared = { state: "invalid", raw: "" };
    }
  } else {
    issues.push({
      ruleId: "content.shared.structure",
      severity: "error",
      category: "structure",
      collection: "news",
      contentId: draft.contentId,
      messageKey: "content.shared.invalid",
      recovery: { kind: "edit-source" },
    });
    shared = unavailable(draft.shared.sourceState);
  }

  const locales = {} as LoadedNewsUnit["locales"];
  for (const locale of ["ja", "en"] as const) {
    const draftSource = draft.locales[locale];
    if (draftSource.state === "unavailable") {
      issues.push(
        unavailableIssue(draft.contentId, locale, draftSource.sourceState),
      );
      locales[locale] = unavailable(draftSource.sourceState);
      continue;
    }
    const { body, ...localized } = draftSource.value;
    const result = newsLocalizedSchema.safeParse(localized);
    if (!result.success) {
      issues.push(
        validationIssue(
          draft.contentId,
          locale,
          result.error.issues
            .map((item) => item.path.join("."))
            .filter(Boolean),
        ),
      );
      locales[locale] = { state: "invalid", raw: "" };
      continue;
    }
    for (const [fieldPath, candidate] of Object.entries(draftSource.value))
      if (candidate.includes("__TODO_"))
        issues.push({
          ruleId: "content.placeholder.unresolved",
          severity: "error",
          category: "content-quality",
          collection: "news",
          contentId: draft.contentId,
          locale,
          fieldPath,
          messageKey: "content.placeholder.unresolved",
          recovery: { kind: "edit-field", fieldPath },
        });
    locales[locale] = {
      state: "valid",
      raw: "",
      value: { ...result.data, body },
    };
  }

  // Legacy callers still mutate `data`; keep their validation fail-closed
  // until every write boundary accepts the localized draft directly.
  const legacy = newsSchema.safeParse(draft.data);
  if (!legacy.success)
    issues.push(
      ...legacy.error.issues.map((item) =>
        validationIssue(draft.contentId, "ja", [item.path.join(".")]),
      ),
    );

  const capabilities = evaluateNewsCapabilities({
    contentId: draft.contentId,
    directory: "",
    shared,
    locales,
    issues,
  });
  const legacyAllowed = draft.sourceModel === "legacy" && legacy.success;
  return {
    issues,
    capabilities: {
      save: capabilities.save.allowed,
      preview: {
        ja: legacyAllowed || capabilities.preview.ja.allowed,
        en: capabilities.preview.en.allowed,
      },
      publish: legacyAllowed || capabilities.publish.allowed,
    },
  };
}

export const isNewsEditorDraftDirty = (
  initial: NewsEditorDraftState,
  current: NewsEditorDraftState,
) => JSON.stringify(initial) !== JSON.stringify(current);
