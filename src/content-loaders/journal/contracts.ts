import type {
  JournalEntryData,
  JournalLocalized,
  JournalShared,
} from "./schema.ts";
export type {
  JournalEntryData,
  JournalLocalized,
  JournalShared,
} from "./schema.ts";

export type Locale = "ja" | "en";
export type Visibility = "public" | "hidden";

export type ContentIssue = {
  ruleId: string;
  severity: "error" | "warning" | "info";
  category:
    | "parse"
    | "structure"
    | "unit-integrity"
    | "repository-integrity"
    | "content-quality"
    | "conflict"
    | "adapter"
    | "infrastructure";
  collection?: string;
  contentId?: string;
  locale?: Locale;
  file?: string;
  fieldPath?: string;
  stage?: "parseData" | "render";
  renderBlocking?: boolean;
  diagnostic?: {
    name: string;
    message: string;
  };
  messageKey: string;
  params?: Record<string, string | number | boolean>;
  recovery?: {
    kind:
      | "edit-field"
      | "edit-source"
      | "reload"
      | "resolve-reference"
      | "retry"
      | "manual-review";
    fieldPath?: string;
  };
};

export type SourceState<T> =
  | { state: "valid"; raw: string; value: T }
  | { state: "invalid"; raw: string }
  | { state: "missing" };

export type LoadedJournalUnit = {
  contentId: string;
  directory: string;
  shared: SourceState<JournalShared>;
  locales: Record<Locale, SourceState<JournalLocalized & { body: string }>>;
  issues: ContentIssue[];
};

export type JournalEntry = {
  id: string;
  data: JournalEntryData;
  body: string;
  filePath?: string;
  digest?: string;
  rendered?: unknown;
};
