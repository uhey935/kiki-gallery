import type { CollectionEntry } from "astro:content";
import type { ExhibitionWithStatus } from "./groupExhibitionsByArtist";

type Artist = CollectionEntry<"artists">;

export function getFeaturedExhibitions(
  artists: Artist[],
  exhibitionsByArtist: Record<string, ExhibitionWithStatus[]>
) {
  return artists
    .map((artist) => {
      const related = exhibitionsByArtist[artist.id] || [];

      // ongoing（終了が近い順）
      const ongoing = related
        .filter((e) => e.status === "ongoing")
        .sort((a, b) => {
          const endA = new Date(
            (a.data.endDate ?? a.data.startDate) + "T23:59:59"
          ).getTime();
          const endB = new Date(
            (b.data.endDate ?? b.data.startDate) + "T23:59:59"
          ).getTime();
          return endA - endB;
        })[0];

      if (ongoing) {
        return {
          artist,
          exhibition: ongoing,
          status: "ongoing" as const,
        };
      }

      // upcoming（開始が近い順）
      const upcoming = related
        .filter((e) => e.status === "upcoming")
        .sort((a, b) => {
          const startA = new Date(
            a.data.startDate + "T00:00:00"
          ).getTime();
          const startB = new Date(
            b.data.startDate + "T00:00:00"
          ).getTime();
          return startA - startB;
        })[0];

      if (upcoming) {
        return {
          artist,
          exhibition: upcoming,
          status: "upcoming" as const,
        };
      }

      return null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}