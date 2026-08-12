import type { ExhibitionWithStatus } from "./groupExhibitionsByArtist";

type Artist = { id: string };

export function getFeaturedExhibitions(
  artists: Artist[],
  exhibitionsByArtist: Record<string, ExhibitionWithStatus[]>,
) {
  return artists
    .map((artist) => {
      const related = exhibitionsByArtist[artist.id] || [];

      // ongoing（終了が近い順）
      const ongoing = related
        .filter((e) => e.status === "ongoing")
        .sort((a, b) => {
          const endA = a.data.end_date.getTime();
          const endB = b.data.end_date.getTime();
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
          const startA = a.data.start_date.getTime();
          const startB = b.data.start_date.getTime();
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
