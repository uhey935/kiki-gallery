import type {
  ExhibitionLocale,
  ExhibitionLocalized,
  ExhibitionShared,
} from "./schema.ts";
export type {
  ExhibitionLocale,
  ExhibitionLocalized,
  ExhibitionShared,
} from "./schema.ts";

export type ExhibitionIssue = {
  ruleId: string;
  severity: "error" | "warning";
  category:
    "parse" | "structure" | "unit-integrity" | "content-quality" | "dependency";
  collection: "exhibitions";
  contentId: string;
  locale?: ExhibitionLocale;
  file?: string;
  messageKey: string;
};
export type SourceState<T> =
  | { state: "valid"; raw: string; value: T; body?: string }
  | { state: "invalid"; raw: string }
  | { state: "missing" };
export type LoadedExhibitionUnit = {
  contentId: string;
  directory: string;
  shared: SourceState<ExhibitionShared>;
  locales: Record<ExhibitionLocale, SourceState<ExhibitionLocalized>>;
  issues: ExhibitionIssue[];
};
