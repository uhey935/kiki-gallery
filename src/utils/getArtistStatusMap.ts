import type { CollectionEntry } from "astro:content";
import type { ExhibitionWithStatus } from "./groupExhibitionsByArtist";

type Artist = CollectionEntry<"artists">;

export type ArtistStatus = "ongoing" | "upcoming" | "past";

export function getArtistStatusMap(
  artists: Artist[],
  exhibitionsByArtist: Record<string, ExhibitionWithStatus[]>
): Record<string, ArtistStatus> {
  const map: Record<string, ArtistStatus> = {};

  artists.forEach((artist) => {
    const related = exhibitionsByArtist[artist.id] || [];

    let status: ArtistStatus = "past";

    if (related.some((e) => e.status === "ongoing")) {
      status = "ongoing";
    } else if (related.some((e) => e.status === "upcoming")) {
      status = "upcoming";
    }

    map[artist.id] = status;
  });

  return map;
}