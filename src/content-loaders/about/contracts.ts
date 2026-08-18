import type {
  AboutLocale,
  AboutLocalizedFrontmatter,
  AboutShared,
} from "./schema.ts";

export type AboutSourceState<T> =
  | { state: "valid"; raw: string; value: T }
  | { state: "invalid"; raw: string }
  | { state: "missing" };

export type AboutLocalized = AboutLocalizedFrontmatter & { body: string };

export type AboutIssue = {
  category:
    | "structure"
    | "unit-integrity"
    | "asset"
    | "factual-approval"
    | "content-quality"
    | "dependency";
  locale?: AboutLocale;
  message: string;
};

export type LoadedAboutUnit = {
  contentId: "about";
  directory: string;
  shared: AboutSourceState<AboutShared>;
  locales: Record<AboutLocale, AboutSourceState<AboutLocalized>>;
  issues: AboutIssue[];
};

export type AboutAssetAvailability = Record<
  "hero" | "gallery-1" | "gallery-2" | "gallery-3" | "gallery-4",
  boolean
>;
