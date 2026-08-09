import assert from "node:assert/strict";
import test from "node:test";

import {
  assertClosedDeleteReferenceGraph,
  parseMarkdownDeleteReferences,
} from "./delete-reference-parser.ts";

test("Delete parser closes inline, definition, autolink, and unsupported internal routes", () => {
  const parsed = parseMarkdownDeleteReferences(`
[Artist](/artists/artist-one)
[Work][work]
<https://example.com>
</exhibitions/show-one>
[Unknown](/news/item-one)
[work]: /works/work-one
`);
  assert.deepEqual(
    parsed.filter((item) => item.target).map((item) => item.target),
    [
      { collection: "artists", contentId: "artist-one" },
      { collection: "works", contentId: "work-one" },
      { collection: "exhibitions", contentId: "show-one" },
    ],
  );
  assert.throws(
    () => assertClosedDeleteReferenceGraph(parsed),
    /\/news\/item-one/,
  );
});
