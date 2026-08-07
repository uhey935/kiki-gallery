import type { EditorCollectionState } from "./collection-contracts.ts";
import { readJournalEditorState } from "./journal-state.ts";
import { readWorksEditorState } from "./works-state.ts";

export type EditorCollectionAdapter = {
  id: "journal" | "works";
  label: string;
  description: string;
  readState: () => Promise<EditorCollectionState>;
};

export const editorCollectionRegistry = {
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
  works: {
    id: "works",
    label: "Works",
    description: "Flat Markdown · read-only slice",
    readState: readWorksEditorState,
  },
} satisfies Record<string, EditorCollectionAdapter>;

export const editorCollectionAdapters = Object.values(editorCollectionRegistry);

export function getEditorCollectionAdapter(
  id: string,
): EditorCollectionAdapter | undefined {
  return editorCollectionRegistry[id as keyof typeof editorCollectionRegistry];
}
