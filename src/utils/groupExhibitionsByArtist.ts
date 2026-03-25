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
      exh.data.startDate,
      exh.data.endDate
    );

    const withStatus: ExhibitionWithStatus = {
      ...exh,
      status,
    };

    if (!grouped[exh.data.artist]) {
      grouped[exh.data.artist] = [];
    }

    grouped[exh.data.artist].push(withStatus);
  });

  return grouped;
}