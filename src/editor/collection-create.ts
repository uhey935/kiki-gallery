import path from "node:path";

import { type ArtistsEditorDraftState } from "./artists-draft-state.ts";
import { createArtistsThreeFileEntry, type ArtistsCreateFileSystem } from "./artists-create.ts";
import { type ExhibitionsEditorDraftState } from "./exhibitions-draft-state.ts";
import { createExhibitionsThreeFileEntry, type ExhibitionsCreateFileSystem } from "./exhibitions-create.ts";
import { type NewsEditorDraftState } from "./news-draft-state.ts";
import {
  createNewsThreeFileEntry,
  type NewsCreateFileSystem,
} from "./news-create.ts";
import { type WorksEditorDraftState } from "./works-draft-state.ts";
import { createWorksThreeFileEntry, type WorksCreateFileSystem } from "./works-create.ts";

type WorksCreateOptions = { root?: string; fileSystem?: WorksCreateFileSystem };
type NewsCreateOptions = { root?: string; fileSystem?: NewsCreateFileSystem };
type ArtistsCreateOptions = { root?: string; fileSystem?: ArtistsCreateFileSystem };
type ExhibitionsCreateOptions = { root?: string; fileSystem?: ExhibitionsCreateFileSystem };

export const createWorksEditorEntry = (
  draft: WorksEditorDraftState,
  options: WorksCreateOptions = {},
) =>
  createWorksThreeFileEntry(
    draft,
    options.root ?? path.resolve("src/content/works"),
    options.fileSystem,
  );

export const createArtistsEditorEntry = (
  draft: ArtistsEditorDraftState,
  options: ArtistsCreateOptions = {},
) =>
  createArtistsThreeFileEntry(draft, options.root ?? path.resolve("src/content/artists"), options.fileSystem);

export const createExhibitionsEditorEntry = (
  draft: ExhibitionsEditorDraftState,
  options: ExhibitionsCreateOptions = {},
) =>
  createExhibitionsThreeFileEntry(draft, options.root ?? path.resolve("src/content/exhibitions"), options.fileSystem);

export const createNewsEditorEntry = (
  draft: NewsEditorDraftState,
  options: NewsCreateOptions = {},
) =>
  createNewsThreeFileEntry(
    draft,
    options.root ?? path.resolve("src/content/news"),
    options.fileSystem,
  );
