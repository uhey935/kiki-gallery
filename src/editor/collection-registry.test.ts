import assert from "node:assert/strict";
import test from "node:test";

import { getEditorCollectionAdapter } from "./collection-registry.ts";

test("collection dispatch resolves distinct Journal and Works adapters", () => {
  const journal = getEditorCollectionAdapter("journal");
  const works = getEditorCollectionAdapter("works");
  assert.equal(journal?.id, "journal");
  assert.equal(works?.id, "works");
  assert.notEqual(journal?.readState, works?.readState);
  assert.equal(getEditorCollectionAdapter("unknown"), undefined);
});
