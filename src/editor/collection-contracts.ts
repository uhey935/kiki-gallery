export type EditorEntrySummary = {
  contentId: string;
  title: string;
  detail: string;
  status: "valid" | "issues";
  statusLabel: string;
};

export type EditorCollectionState = { entries: EditorEntrySummary[] };
