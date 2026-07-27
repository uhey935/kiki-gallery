import type { CollectionEntry } from "astro:content";
import { getExhibitionStatus } from "./exhibitionStatus";

type Exhibition = CollectionEntry<"exhibitions">;

export type ExhibitionWithStatus = Exhibition & {
  status: "ongoing" | "upcoming" | "past";
};

export function groupExhibitionsByArtist(
  exhibitions: Exhibition[]
): Record<string, ExhibitionWithStatus[]> {
  const grouped: Record<string, ExhibitionWithStatus[]> = {};

  exhibitions.forEach((exh) => {
    const status = getExhibitionStatus(
      exh.data.start_date,
      exh.data.end_date
    );

    const withStatus: ExhibitionWithStatus = {
      ...exh,
      status,
    };

    const artists = Array.isArray(exh.data.artist)
      ? exh.data.artist
      : [exh.data.artist];

    artists.forEach((artist) => {
      if (!grouped[artist]) {
        grouped[artist] = [];
      }

      grouped[artist].push(withStatus);
    });
  });

  return grouped;
}