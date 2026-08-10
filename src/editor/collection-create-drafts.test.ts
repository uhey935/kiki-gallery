import assert from "node:assert/strict";
import test from "node:test";

import {
  createNewArtistsDraft,
  createNewExhibitionsDraft,
  createNewNewsDraft,
  createNewWorksDraft,
} from "./collection-create-drafts.ts";
import { validateArtistsEditorDraft } from "./artists-draft-state.ts";
import { validateExhibitionsEditorDraft } from "./exhibitions-draft-state.ts";
import { validateNewsEditorDraft } from "./news-draft-state.ts";
import { validateWorksEditorDraft } from "./works-draft-state.ts";

test("flat Create screens begin with isolated validation-blocked scaffolds", () => {
  const scaffolds = [
    [createNewWorksDraft(), validateWorksEditorDraft],
    [createNewArtistsDraft(), validateArtistsEditorDraft],
    [createNewExhibitionsDraft(), validateExhibitionsEditorDraft],
    [createNewNewsDraft(), validateNewsEditorDraft],
  ] as const;
  for (const [draft, validate] of scaffolds) {
    assert.equal(draft.contentId, "");
    assert.equal(draft.sourceRaw, "");
    const result = validate(draft as never);
    assert.equal(result.capabilities.save, false);
    if (typeof result.capabilities.preview === "boolean")
      assert.equal(result.capabilities.preview, false);
    else
      assert.deepEqual(result.capabilities.preview, { ja: false, en: false });
    assert.equal(result.capabilities.publish, false);
  }
});
