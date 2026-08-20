import assert from "node:assert/strict";
import test from "node:test";

import { editorCollections, editorRoutes } from "./shell.ts";

test("the shell exposes the registered Editor collections", () => {
  assert.deepEqual(
    editorCollections.map(({ id }) => id),
    ["artists", "exhibitions", "works", "journal", "news", "home", "about"],
  );
});

test("editor routes stay under the isolated editor boundary", () => {
  assert.equal(editorRoutes.dashboard, "/editor/");
  assert.equal(editorRoutes.collection("journal"), "/editor/journal/");
  assert.equal(editorRoutes.workspace("journal"), "/editor/journal/workspace/");
  assert.equal(
    editorRoutes.workspace("journal", "valid-public"),
    "/editor/journal/workspace/valid-public/",
  );
  assert.equal(editorRoutes.collection("works"), "/editor/works/");
});
