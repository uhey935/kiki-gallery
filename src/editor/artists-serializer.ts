import { stringify } from "yaml";
import type { ArtistsEditorDraftState } from "./artists-draft-state.ts";
export function serializeArtistsEditorDraft(draft: ArtistsEditorDraftState) {
  const data = {
    name: draft.data.name,
    ...(draft.data.display_name === undefined
      ? {}
      : { display_name: draft.data.display_name }),
    hero: draft.data.hero,
    hero_alt: draft.data.hero_alt,
    ...(draft.data.biography === undefined
      ? {}
      : { biography: draft.data.biography }),
    short_bio: draft.data.short_bio,
    medium: draft.data.medium,
    ...(draft.data.works_layout === undefined
      ? {}
      : {
          works_layout: draft.data.works_layout.map((section) => ({
            layout: section.layout,
            works: section.works.map(({ id }) => id),
          })),
        }),
    ...(draft.data.seo_title === undefined
      ? {}
      : { seo_title: draft.data.seo_title }),
    ...(draft.data.description === undefined
      ? {}
      : { description: draft.data.description }),
  };
  return `---\n${stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n${draft.body ? `\n${draft.body.trim()}\n` : ""}`;
}
