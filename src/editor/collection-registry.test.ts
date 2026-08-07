import assert from "node:assert/strict";
import test from "node:test";

import { getEditorCollectionAdapter } from "./collection-registry.ts";

test("collection dispatch resolves distinct collection adapters", () => {
  const artists = getEditorCollectionAdapter("artists");
  const journal = getEditorCollectionAdapter("journal");
  const works = getEditorCollectionAdapter("works");
  const news = getEditorCollectionAdapter("news");
  const home = getEditorCollectionAdapter("home");
  assert.equal(artists?.id, "artists");
  assert.equal(journal?.id, "journal");
  assert.equal(works?.id, "works");
  assert.equal(news?.id, "news");
  assert.equal(home?.id, "home");
  assert.notEqual(journal?.readState, works?.readState);
  assert.notEqual(artists?.readState, works?.readState);
  assert.notEqual(news?.readState, works?.readState);
  assert.equal(getEditorCollectionAdapter("unknown"), undefined);
});
