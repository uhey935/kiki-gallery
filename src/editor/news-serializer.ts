import { Scalar, stringify } from "yaml";
import type {
  NewsLocale,
  NewsLocalized,
  NewsShared,
} from "../content-loaders/news/contracts.ts";
import type {
  NewsEditorDraftSource,
  NewsEditorDraftState,
} from "./news-draft-state.ts";

export type NewsSerializedFiles = {
  "index.yaml": string;
  "ja.md": string;
  "en.md": string;
};

export class NewsDraftNotSerializableError extends Error {
  constructor(scope: "shared" | NewsLocale) {
    super(`News draft source is unavailable: ${scope}`);
    this.name = "NewsDraftNotSerializableError";
  }
}

function value<T>(
  source: NewsEditorDraftSource<T>,
  scope: "shared" | NewsLocale,
): T {
  if (source.state === "unavailable")
    throw new NewsDraftNotSerializableError(scope);
  return source.value;
}

function sharedYaml(shared: NewsShared) {
  const date = new Scalar(shared.date);
  date.type = Scalar.QUOTE_DOUBLE;
  return stringify(
    {
      date,
      news_type: shared.news_type,
      ...(shared.link === undefined ? {} : { link: shared.link }),
      show_on_home: shared.show_on_home,
    },
    { lineWidth: 0 },
  );
}

function localeMarkdown(localized: NewsLocalized & { body: string }) {
  const { body } = localized;
  const frontmatter = {
    title: localized.title,
    ...(localized.summary === undefined ? {} : { summary: localized.summary }),
  };
  return `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${body}`;
}

export function serializeNewsEditorDraft(
  draft: NewsEditorDraftState,
): NewsSerializedFiles {
  return {
    "index.yaml": sharedYaml(value(draft.shared, "shared")),
    "ja.md": localeMarkdown(value(draft.locales.ja, "ja")),
    "en.md": localeMarkdown(value(draft.locales.en, "en")),
  };
}
