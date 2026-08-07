import { Scalar, stringify } from "yaml";
import type { NewsEditorDraftState } from "./news-draft-state.ts";
export function serializeNewsEditorDraft(draft: NewsEditorDraftState) {
  const date = new Scalar(draft.data.date);
  date.type = Scalar.QUOTE_DOUBLE;
  const data = {
    title: draft.data.title,
    date,
    news_type: draft.data.news_type,
    ...(draft.data.summary === undefined
      ? {}
      : { summary: draft.data.summary }),
    ...(draft.data.link === undefined ? {} : { link: draft.data.link }),
    show_on_home: draft.data.show_on_home,
  };
  return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n`;
}
