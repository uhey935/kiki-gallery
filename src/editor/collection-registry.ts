import type { EditorCollectionState } from "./collection-contracts.ts";
import { readJournalEditorState } from "./journal-state.ts";
import { readWorksEditorState } from "./works-state.ts";
import { readExhibitionsEditorState } from "./exhibitions-state.ts";
import { readArtistsEditorState } from "./artists-state.ts";
import { readNewsEditorState } from "./news-state.ts";
import { readHomeEditorState } from "./home-state.ts";
import { readAboutEditorState } from "./about-state.ts";

export type EditorCollectionAdapter = {
  id:
    "journal" | "works" | "exhibitions" | "artists" | "news" | "home" | "about";
  label: string;
  description: string;
  readState: () => Promise<EditorCollectionState>;
};

export const editorCollectionRegistry = {
  about: {
    id: "about",
    label: "About",
    description: "Localized singleton · Shared, JA, and EN drafts",
    readState: readAboutEditorState,
  },
  home: {
    id: "home",
    label: "Home",
    description: "Localized singleton · Shared, JA, and EN drafts",
    readState: readHomeEditorState,
  },
  artists: {
    id: "artists",
    label: "Artists",
    description:
      "Three-file Content Unit · localized biography and Work references",
    readState: readArtistsEditorState,
  },
  exhibitions: {
    id: "exhibitions",
    label: "Exhibitions",
    description: "Flat Markdown · schedule, references, and presentation",
    readState: readExhibitionsEditorState,
  },
  journal: {
    id: "journal",
    label: "Journal",
    description: "Three-file Content Units",
    readState: async () => {
      const state = await readJournalEditorState();
      return {
        entries: state.entries.map((entry) => ({
          contentId: entry.contentId,
          title: entry.title,
          detail: `${entry.date ?? "Invalid shared data"} · JA ${entry.localeStatus.ja} · EN ${entry.localeStatus.en}`,
          status: entry.structuralStatus,
          statusLabel:
            entry.issueCount === 0 ? "Ready" : `${entry.issueCount} issues`,
        })),
      };
    },
  },
  news: {
    id: "news",
    label: "News",
    description: "Flat Markdown · announcements and optional links",
    readState: readNewsEditorState,
  },
  works: {
    id: "works",
    label: "Works",
    description: "Flat Markdown · Save, Preview, and Publish",
    readState: readWorksEditorState,
  },
} satisfies Record<string, EditorCollectionAdapter>;

export const editorCollectionAdapters = Object.values(editorCollectionRegistry);

export function getEditorCollectionAdapter(
  id: string,
): EditorCollectionAdapter | undefined {
  return editorCollectionRegistry[id as keyof typeof editorCollectionRegistry];
}
