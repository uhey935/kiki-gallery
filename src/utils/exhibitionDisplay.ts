import type { CollectionEntry } from "astro:content";
import type { ArtistProductionEntry } from "../content-boundaries/artists-production";

type Artist = ArtistProductionEntry;
type Exhibition = CollectionEntry<"exhibitions">;

export function getArtistDisplayName(artist: Artist): string {
  return artist.data.display_name ?? artist.data.name;
}

export function resolveExhibitionArtists(
  exhibition: Exhibition,
  artistMap: ReadonlyMap<string, Artist>,
): Artist[] {
  return exhibition.data.artists.map((artistReference) => {
    const artist = artistMap.get(artistReference.id);

    if (!artist) {
      throw new Error(
        `Exhibition "${exhibition.id}" references missing Artist "${artistReference.id}".`,
      );
    }

    return artist;
  });
}

export function getExhibitionDisplayTitle(
  exhibition: Exhibition,
  artists: Artist[],
): string {
  if (exhibition.data.title) return exhibition.data.title;

  const artistNames = artists.map(getArtistDisplayName);

  return artistNames.length > 1
    ? `${artistNames.join("、")} 合同展`
    : `${artistNames[0]} 個展`;
}
