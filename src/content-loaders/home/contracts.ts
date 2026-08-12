import type { HomeLocale, HomeLocalized, HomeShared } from "./schema.ts";

export type HomeSourceState<T> =
  | { state: "valid"; raw: string; value: T }
  | { state: "invalid"; raw: string }
  | { state: "missing" };

export type HomeIssue = {
  category: "structure" | "unit-integrity" | "content-quality" | "dependency";
  locale?: HomeLocale;
  message: string;
};

export type LoadedHomeUnit = {
  contentId: "home";
  directory: string;
  shared: HomeSourceState<HomeShared>;
  locales: Record<HomeLocale, HomeSourceState<HomeLocalized>>;
  issues: HomeIssue[];
};

export type HomeDestinationAvailability = Record<
  HomeLocale,
  Record<"artists" | "about", boolean>
>;
