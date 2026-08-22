import { evaluateJournalCapabilities } from "../content-loaders/journal/capabilities.ts";
import type {
  ContentIssue,
  LoadedJournalUnit,
  Locale,
  SourceState,
} from "../content-loaders/journal/contracts.ts";
import {
  journalLocalizedSchema,
  journalSharedSchema,
  type JournalCategory,
  type JournalLocalized,
  type JournalShared,
} from "../content-loaders/journal/schema.ts";
import type { JournalEditorEntryState } from "./journal-state.ts";

export type JournalEditorDraftSource<T> =
  | { state: "editable"; value: T }
  | { state: "unavailable"; sourceState: "invalid" | "missing" };

export type JournalEditorSharedDraft = Omit<JournalShared, "category"> & {
  category: JournalCategory | "";
};

export type JournalEditorDraftState = {
  contentId: string;
  shared: JournalEditorDraftSource<JournalEditorSharedDraft>;
  locales: Record<
    Locale,
    JournalEditorDraftSource<JournalLocalized & { body: string }>
  >;
};

export type JournalEditorDraftValidation = {
  issues: ContentIssue[];
  capabilities: {
    save: boolean;
    preview: Record<Locale, boolean>;
    publish: boolean;
  };
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function toDraftSource<T>(source: SourceState<T>): JournalEditorDraftSource<T> {
  return source.state === "valid"
    ? { state: "editable", value: clone(source.value) }
    : { state: "unavailable", sourceState: source.state };
}

function unavailableSource<T>(state: "invalid" | "missing"): SourceState<T> {
  return state === "invalid"
    ? { state: "invalid", raw: "" }
    : { state: "missing" };
}

export function createJournalEditorDraft(
  entry: JournalEditorEntryState,
): JournalEditorDraftState {
  return {
    contentId: entry.contentId,
    shared: toDraftSource(entry.shared),
    locales: {
      ja: toDraftSource(entry.locales.ja),
      en: toDraftSource(entry.locales.en),
    },
  };
}

export function updateJournalEditorDraft(
  draft: JournalEditorDraftState,
  update: (next: JournalEditorDraftState) => void,
): JournalEditorDraftState {
  const next = clone(draft);
  update(next);
  return next;
}

export function isJournalEditorDraftDirty(
  initial: JournalEditorDraftState,
  current: JournalEditorDraftState,
): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}

function validationIssue(
  contentId: string,
  scope: "shared" | Locale,
  fields: string[],
): ContentIssue {
  const locale = scope === "shared" ? undefined : scope;
  return {
    ruleId:
      scope === "shared"
        ? "content.shared.structure"
        : "content.locale.structure",
    severity: "error",
    category: "structure",
    collection: "journal",
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
  scope: "shared" | Locale,
  state: "invalid" | "missing",
): ContentIssue {
  const kind = scope === "shared" ? "shared" : "locale";
  return {
    ruleId:
      state === "missing"
        ? "content.file.missing"
        : `content.${kind}.structure`,
    severity: "error",
    category: state === "missing" ? "unit-integrity" : "structure",
    collection: "journal",
    contentId,
    locale: scope === "shared" ? undefined : scope,
    messageKey:
      state === "missing" ? "content.file.missing" : `content.${kind}.invalid`,
    recovery: { kind: "edit-source" },
  };
}

export function validateJournalEditorDraft(
  draft: JournalEditorDraftState,
): JournalEditorDraftValidation {
  const issues: ContentIssue[] = [];
  const shared: LoadedJournalUnit["shared"] =
    draft.shared.state === "editable"
      ? (() => {
          const result = journalSharedSchema.safeParse(draft.shared.value);
          if (result.success)
            return { state: "valid", raw: "", value: result.data } as const;
          issues.push(
            validationIssue(
              draft.contentId,
              "shared",
              result.error.issues
                .map((item) => item.path.join("."))
                .filter(Boolean),
            ),
          );
          return { state: "invalid", raw: "" } as const;
        })()
      : (() => {
          issues.push(
            unavailableIssue(
              draft.contentId,
              "shared",
              draft.shared.sourceState,
            ),
          );
          return unavailableSource(draft.shared.sourceState);
        })();

  const locales = {} as LoadedJournalUnit["locales"];
  for (const locale of ["ja", "en"] as const) {
    const source = draft.locales[locale];
    if (source.state === "unavailable") {
      issues.push(
        unavailableIssue(draft.contentId, locale, source.sourceState),
      );
      locales[locale] = unavailableSource(source.sourceState);
      continue;
    }
    const { body, ...localized } = source.value;
    const result = journalLocalizedSchema.safeParse(localized);
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
    for (const [fieldPath, candidate] of Object.entries(source.value)) {
      if (candidate.includes("__TODO_")) {
        issues.push({
          ruleId: "content.placeholder.unresolved",
          severity: "error",
          category: "content-quality",
          collection: "journal",
          contentId: draft.contentId,
          locale,
          fieldPath,
          messageKey: "content.placeholder.unresolved",
          recovery: {
            kind: fieldPath === "body" ? "edit-source" : "edit-field",
            fieldPath,
          },
        });
      }
    }
    locales[locale] = { state: "valid", raw: "", value: source.value };
  }

  const unit: LoadedJournalUnit = {
    contentId: draft.contentId,
    directory: "",
    shared,
    locales,
    issues,
  };
  const capabilities = evaluateJournalCapabilities(unit);
  return {
    issues,
    capabilities: {
      save: capabilities.save.allowed,
      preview: {
        ja: capabilities.preview.ja.allowed,
        en: capabilities.preview.en.allowed,
      },
      publish: capabilities.publish.allowed,
    },
  };
}
