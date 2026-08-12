import path from "node:path";

import { type ArtistsEditorDraftState } from "./artists-draft-state.ts";
import { createArtistsThreeFileEntry, type ArtistsCreateFileSystem } from "./artists-create.ts";
import { type ExhibitionsEditorDraftState } from "./exhibitions-draft-state.ts";
import { createExhibitionsThreeFileEntry, type ExhibitionsCreateFileSystem } from "./exhibitions-create.ts";
import {
  createFlatEditorEntry,
  type FlatCreateFileSystem,
} from "./flat-create.ts";
import { type NewsEditorDraftState } from "./news-draft-state.ts";
import {
  createNewsThreeFileEntry,
  type NewsCreateFileSystem,
} from "./news-create.ts";
import {
  createWorksEditorDraft,
  type WorksEditorDraftState,
  validateWorksEditorDraft,
} from "./works-draft-state.ts";
import { serializeWorksEditorDraft } from "./works-serializer.ts";
import { readWorksEditorEntry } from "./works-state.ts";

type FlatCreateOptions = { root?: string; fileSystem?: FlatCreateFileSystem };
type NewsCreateOptions = { root?: string; fileSystem?: NewsCreateFileSystem };
type ArtistsCreateOptions = { root?: string; fileSystem?: ArtistsCreateFileSystem };
type ExhibitionsCreateOptions = { root?: string; fileSystem?: ExhibitionsCreateFileSystem };

export const createWorksEditorEntry = (
  draft: WorksEditorDraftState,
  options: FlatCreateOptions = {},
) =>
  createFlatEditorEntry({
    collectionId: "works",
    collectionLabel: "Work",
    draft,
    root: options.root ?? path.resolve("src/content/works"),
    validate: (value) => validateWorksEditorDraft(value).capabilities.save,
    serialize: serializeWorksEditorDraft,
    reread: async (id, root) =>
      createWorksEditorDraft(await readWorksEditorEntry(id, root)),
    fileSystem: options.fileSystem,
  });

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
