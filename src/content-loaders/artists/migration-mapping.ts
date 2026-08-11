import type { ArtistIdentity, ArtistLocalized } from "./schema.ts";

export type LegacyArtistMigrationInput = {
  name: string;
  display_name?: string;
  hero: { image: string };
  works_layout?: ArtistIdentity["works_layout"];
  medium: string[];
  short_bio: string;
  biography?: string;
  hero_alt: string;
  seo_title?: string;
  description?: string;
};

export type ArtistMigrationMapping = {
  shared: ArtistIdentity;
  ja: ArtistLocalized;
  en: ArtistLocalized;
};

const TODO = {
  short_bio: "__TODO_EN_SHORT_BIO__",
  biography: "__TODO_EN_BIOGRAPHY__",
  hero_alt: "__TODO_EN_HERO_ALT__",
} as const;

/**
 * Specification-only mapping for a future migration converter.
 * The JA name decision is materialized here and is never a runtime fallback.
 */
export function specifyLegacyArtistMapping(
  legacy: LegacyArtistMigrationInput,
): ArtistMigrationMapping {
  return {
    shared: {
      sort_name: legacy.name,
      hero: legacy.hero,
      ...(legacy.works_layout ? { works_layout: legacy.works_layout } : {}),
      medium: legacy.medium,
    },
    ja: {
      name: legacy.display_name ?? legacy.name,
      short_bio: legacy.short_bio,
      ...(legacy.biography ? { biography: legacy.biography } : {}),
      hero_alt: legacy.hero_alt,
      ...(legacy.seo_title ? { seo_title: legacy.seo_title } : {}),
      ...(legacy.description ? { description: legacy.description } : {}),
    },
    en: {
      name: legacy.name,
      short_bio: TODO.short_bio,
      ...(legacy.biography ? { biography: TODO.biography } : {}),
      hero_alt: TODO.hero_alt,
    },
  };
}
