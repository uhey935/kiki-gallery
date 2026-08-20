import type {
  ArtistIdentity,
  ArtistLocale,
  ArtistLocalized,
} from "./schema.ts";
export type {
  ArtistIdentity,
  ArtistLocale,
  ArtistLocalized,
} from "./schema.ts";

export type ArtistContentIssue = {
  ruleId: string;
  severity: "error" | "warning" | "info";
  category:
    | "parse"
    | "structure"
    | "unit-integrity"
    | "repository-integrity"
    | "content-quality";
  collection: "artists";
  contentId: string;
  locale?: ArtistLocale;
  file?: string;
  fieldPath?: string;
  messageKey: string;
};

export type ArtistSourceState<T> =
  | { state: "valid"; raw: string; value: T }
  | { state: "invalid"; raw: string }
  | { state: "missing" };

export type LoadedArtistUnit = {
  contentId: string;
  directory: string;
  identity: ArtistSourceState<ArtistIdentity>;
  locales: Record<ArtistLocale, ArtistSourceState<ArtistLocalized>>;
  issues: ArtistContentIssue[];
};

export type ArtistIdentityEntry = {
  id: string;
  contentId: string;
  data: ArtistIdentity;
};

export type LocalizedArtistEntry = {
  id: string;
  contentId: string;
  locale: ArtistLocale;
  identity: ArtistIdentity;
  data: ArtistLocalized;
};
