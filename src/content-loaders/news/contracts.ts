import type { NewsEntryData, NewsLocalized, NewsShared } from "./schema.ts";
export type { NewsEntryData, NewsLocalized, NewsShared } from "./schema.ts";

export type NewsLocale = "ja" | "en";

export type NewsContentIssue = {
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
  collection?: "news";
  contentId?: string;
  locale?: NewsLocale;
  file?: string;
  fieldPath?: string;
  stage?: "parseData" | "render";
  renderBlocking?: boolean;
  diagnostic?: { name: string; message: string };
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

export type NewsSourceState<T> =
  | { state: "valid"; raw: string; value: T }
  | { state: "invalid"; raw: string }
  | { state: "missing" };

export type LoadedNewsUnit = {
  contentId: string;
  directory: string;
  shared: NewsSourceState<NewsShared>;
  locales: Record<
    NewsLocale,
    NewsSourceState<NewsLocalized & { body: string }>
  >;
  issues: NewsContentIssue[];
};

export type NewsEntry = {
  id: string;
  data: NewsEntryData;
  body: string;
  filePath?: string;
  digest?: string;
  rendered?: unknown;
};
