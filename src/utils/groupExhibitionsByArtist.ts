import { getExhibitionStatus } from "./exhibitionStatus";
import type { ExhibitionProductionEntry } from "../content-boundaries/exhibitions-production";

type Exhibition = ExhibitionProductionEntry;

export type ExhibitionWithStatus = Exhibition & {
  status: "ongoing" | "upcoming" | "past";
};

export function groupExhibitionsByArtist(
  exhibitions: Exhibition[],
): Record<string, ExhibitionWithStatus[]> {
  const grouped: Record<string, ExhibitionWithStatus[]> = {};

  exhibitions.forEach((exh) => {
    const status = getExhibitionStatus(exh.data.start_date, exh.data.end_date);

    const withStatus: ExhibitionWithStatus = {
      ...exh,
      status,
    };

    const artists = exh.data.artists;

    artists.forEach((artist) => {
      if (!grouped[artist.id]) {
        grouped[artist.id] = [];
      }

      grouped[artist.id].push(withStatus);
    });
  });

  return grouped;
}
