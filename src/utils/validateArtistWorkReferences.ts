import type { CollectionEntry } from "astro:content";
import type { ArtistProductionEntry } from "../content-boundaries/artists-production";

type ArtistEntry = ArtistProductionEntry;
type WorkEntry = CollectionEntry<"works">;

/**
 * Validates relationships that require access to both Artist and Work
 * collections. Per-Artist structure and duplicate references remain the
 * responsibility of artistSchema in content.config.ts.
 */
export function validateArtistWorkReferences(
  artists: readonly ArtistEntry[],
  works: readonly WorkEntry[],
): void {
  const workById = new Map(works.map((work) => [work.id, work]));

  for (const artist of artists) {
    for (const section of artist.data.works_layout ?? []) {
      for (const workReference of section.works) {
        const workId = workReference.id;
        const work = workById.get(workId);

        if (!work) {
          throw new Error(
            `[Artist/Work validation] Artist "${artist.id}" references missing Work "${workId}".`,
          );
        }

        const workArtistId = work.data.artist.id;

        if (workArtistId !== artist.id) {
          throw new Error(
            `[Artist/Work validation] Artist "${artist.id}" references Work "${workId}", but the Work belongs to Artist "${workArtistId}".`,
          );
        }
      }
    }
  }
}
