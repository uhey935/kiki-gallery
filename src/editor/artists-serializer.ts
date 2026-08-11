import { stringify } from "yaml";
import type { ArtistLocale } from "../content-loaders/artists/contracts.ts";
import { normalizeArtistsEditorDraft, type ArtistsEditorDraftSource, type ArtistsEditorDraftState } from "./artists-draft-state.ts";

export type ArtistsSerializedFiles = { "index.yaml": string; "ja.md": string; "en.md": string };
export class ArtistsDraftNotSerializableError extends Error {}
function value<T>(source: ArtistsEditorDraftSource<T>, scope: "shared" | ArtistLocale): T {
  if (source.state === "unavailable") throw new ArtistsDraftNotSerializableError(`Artist draft source unavailable: ${scope}`);
  return source.value;
}
function localeMarkdown(localized: Record<string, unknown> & { body: string }) {
  const { body, ...frontmatter } = localized;
  return `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${body}`;
}
function unchanged<T>(source: ArtistsEditorDraftSource<T>) {
  return source.state === "editable" && source.raw !== undefined && source.baseline !== undefined && JSON.stringify(source.value) === JSON.stringify(source.baseline) ? source.raw : undefined;
}
export function serializeArtistsEditorDraft(input: ArtistsEditorDraftState): ArtistsSerializedFiles {
  const draft = normalizeArtistsEditorDraft(input);
  return {
    "index.yaml": unchanged(draft.shared) ?? stringify(value(draft.shared, "shared"), { lineWidth: 0 }),
    "ja.md": unchanged(draft.locales.ja) ?? localeMarkdown(value(draft.locales.ja, "ja")),
    "en.md": unchanged(draft.locales.en) ?? localeMarkdown(value(draft.locales.en, "en")),
  };
}
