import { stringify } from "yaml";

import type { Locale } from "../content-loaders/journal/contracts.ts";
import type {
  JournalLocalized,
  JournalShared,
} from "../content-loaders/journal/schema.ts";
import type {
  JournalEditorDraftSource,
  JournalEditorDraftState,
} from "./journal-draft-state.ts";

export type JournalSerializedFiles = {
  "index.yaml": string;
  "ja.md": string;
  "en.md": string;
};

export class JournalDraftNotSerializableError extends Error {
  constructor(scope: "shared" | Locale) {
    super(`Journal draft source is unavailable: ${scope}`);
    this.name = "JournalDraftNotSerializableError";
  }
}

function editableValue<T>(
  source: JournalEditorDraftSource<T>,
  scope: "shared" | Locale,
): T {
  if (source.state === "unavailable") {
    throw new JournalDraftNotSerializableError(scope);
  }
  return source.value;
}

function orderedShared(shared: JournalShared): JournalShared {
  return {
    visibility: shared.visibility,
    date: shared.date,
    categories: shared.categories,
    hero: {
      image: shared.hero.image,
      ...(shared.hero.hero_caption === undefined
        ? {}
        : { hero_caption: shared.hero.hero_caption }),
    },
    ...(shared.author === undefined ? {} : { author: shared.author }),
    ...(shared.credits === undefined ? {} : { credits: shared.credits }),
  };
}

function serializeLocale(
  localized: JournalLocalized & { body: string },
): string {
  const { body } = localized;
  const frontmatter: JournalLocalized = {
    title: localized.title,
    summary: localized.summary,
    hero_alt: localized.hero_alt,
  };
  return `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${body}`;
}

export function serializeJournalEditorDraft(
  draft: JournalEditorDraftState,
): JournalSerializedFiles {
  const shared = editableValue(draft.shared, "shared");
  const ja = editableValue(draft.locales.ja, "ja");
  const en = editableValue(draft.locales.en, "en");

  return {
    "index.yaml": stringify(orderedShared(shared)),
    "ja.md": serializeLocale(ja),
    "en.md": serializeLocale(en),
  };
}
