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
    | "infrastructure";
  collection?: string;
  contentId?: string;
  locale?: Locale;
  file?: string;
  fieldPath?: string;
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

export type JournalCredit = {
  role: string;
  person?: string;
  member?: string;
};

export type JournalShared = {
  date: string;
  categories: Array<"interview" | "essay" | "report">;
  hero: { image: string; hero_caption?: string };
  author?: string;
  credits?: JournalCredit[];
  visibility: Visibility;
};

export type JournalLocalized = {
  title: string;
  summary: string;
  hero_alt: string;
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

export type JournalEntryData = JournalShared &
  JournalLocalized & {
    contentId: string;
    locale: Locale;
  };

export type JournalEntry = {
  id: string;
  data: JournalEntryData;
  body: string;
  filePath?: string;
  digest?: string;
  rendered?: unknown;
};

export type CapabilityResult = {
  allowed: boolean;
  blockers: ContentIssue[];
  warnings: ContentIssue[];
};

export type ContentCapabilities = {
  save: CapabilityResult;
  preview: Record<Locale, CapabilityResult>;
  publish: CapabilityResult;
};
