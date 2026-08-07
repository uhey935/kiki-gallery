export const editorCollections = [
  {
    id: "journal",
    label: "Journal",
    description: "Three-file Content Units",
    state: "ready-for-editor-state",
  },
] as const;

export type EditorCollection = (typeof editorCollections)[number];

export const editorRoutes = {
  dashboard: "/editor/",
  collection: (collectionId: string) => `/editor/${collectionId}/`,
  workspace: (collectionId: string, contentId?: string) =>
    `/editor/${collectionId}/workspace/${contentId ? `${contentId}/` : ""}`,
} as const;
