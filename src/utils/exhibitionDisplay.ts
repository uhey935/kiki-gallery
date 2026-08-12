import type { ArtistProductionEntry } from "../content-boundaries/artists-production";
import type { ExhibitionProductionEntry } from "../content-boundaries/exhibitions-production";

type Artist = ArtistProductionEntry;
type Exhibition = ExhibitionProductionEntry;

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
  _artists: Artist[],
): string {
  return exhibition.data.title;
}
