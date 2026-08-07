import { editorCollectionAdapters } from "./collection-registry.ts";

export const editorCollections = editorCollectionAdapters.map(
  ({ id, label, description }) => ({ id, label, description }),
);

export type EditorCollection = (typeof editorCollections)[number];

export const editorRoutes = {
  dashboard: "/editor/",
  collection: (collectionId: string) => `/editor/${collectionId}/`,
  workspace: (collectionId: string, contentId?: string) =>
    `/editor/${collectionId}/workspace/${contentId ? `${contentId}/` : ""}`,
} as const;
