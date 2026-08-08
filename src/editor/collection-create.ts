import path from "node:path";

import {
  createArtistsEditorDraft,
  type ArtistsEditorDraftState,
  validateArtistsEditorDraft,
} from "./artists-draft-state.ts";
import { serializeArtistsEditorDraft } from "./artists-serializer.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
import {
  createExhibitionsEditorDraft,
  type ExhibitionsEditorDraftState,
  validateExhibitionsEditorDraft,
} from "./exhibitions-draft-state.ts";
import { serializeExhibitionsEditorDraft } from "./exhibitions-serializer.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import {
  createFlatEditorEntry,
  type FlatCreateFileSystem,
} from "./flat-create.ts";
import {
  createNewsEditorDraft,
  type NewsEditorDraftState,
  validateNewsEditorDraft,
} from "./news-draft-state.ts";
import { serializeNewsEditorDraft } from "./news-serializer.ts";
import { readNewsEditorEntry } from "./news-state.ts";
import {
  createWorksEditorDraft,
  type WorksEditorDraftState,
  validateWorksEditorDraft,
} from "./works-draft-state.ts";
import { serializeWorksEditorDraft } from "./works-serializer.ts";
import { readWorksEditorEntry } from "./works-state.ts";

type Options = { root?: string; fileSystem?: FlatCreateFileSystem };

export const createWorksEditorEntry = (
  draft: WorksEditorDraftState,
  options: Options = {},
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
  options: Options = {},
) =>
  createFlatEditorEntry({
    collectionId: "artists",
    collectionLabel: "Artist",
    draft,
    root: options.root ?? path.resolve("src/content/artists"),
    validate: (value) => validateArtistsEditorDraft(value).capabilities.save,
    serialize: serializeArtistsEditorDraft,
    reread: async (id, root) =>
      createArtistsEditorDraft(await readArtistsEditorEntry(id, root)),
    fileSystem: options.fileSystem,
  });

export const createExhibitionsEditorEntry = (
  draft: ExhibitionsEditorDraftState,
  options: Options = {},
) =>
  createFlatEditorEntry({
    collectionId: "exhibitions",
    collectionLabel: "Exhibition",
    draft,
    root: options.root ?? path.resolve("src/content/exhibitions"),
    validate: (value) =>
      validateExhibitionsEditorDraft(value).capabilities.save,
    serialize: serializeExhibitionsEditorDraft,
    reread: async (id, root) =>
      createExhibitionsEditorDraft(await readExhibitionsEditorEntry(id, root)),
    fileSystem: options.fileSystem,
  });

export const createNewsEditorEntry = (
  draft: NewsEditorDraftState,
  options: Options = {},
) =>
  createFlatEditorEntry({
    collectionId: "news",
    collectionLabel: "News",
    draft,
    root: options.root ?? path.resolve("src/content/news"),
    validate: (value) => validateNewsEditorDraft(value).capabilities.save,
    serialize: serializeNewsEditorDraft,
    reread: async (id, root) =>
      createNewsEditorDraft(await readNewsEditorEntry(id, root)),
    fileSystem: options.fileSystem,
  });
