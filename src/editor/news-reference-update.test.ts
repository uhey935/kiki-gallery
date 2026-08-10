import assert from "node:assert/strict";
import test from "node:test";
import {
  findNewsReferenceSpan,
  NewsReferenceStructureError,
} from "./news-reference-update.ts";

function apply(
  bytes: Buffer,
  span: NonNullable<ReturnType<typeof findNewsReferenceSpan>>,
) {
  return Buffer.concat([
    bytes.subarray(0, span.start),
    Buffer.from(span.newValue),
    bytes.subarray(span.end),
  ]);
}

test("finds byte-preserving legacy and three-file News link updates", () => {
  const legacy = Buffer.from(
    '---\ntitle: News\nlink: "/artists/old-artist" # keep\nshow_on_home: true\n---\n',
  );
  const shared = Buffer.from(
    'date: "2026-01-01"\nlink: /artists/old-artist\nshow_on_home: true\n',
  );
  const legacySpan = findNewsReferenceSpan(
    "src/content/news/example.md",
    legacy,
    "artists",
    "old-artist",
    "new-artist",
  )!;
  const sharedSpan = findNewsReferenceSpan(
    "src/content/news/example/index.yaml",
    shared,
    "artists",
    "old-artist",
    "new-artist",
  )!;
  assert.equal(
    apply(legacy, legacySpan).toString(),
    legacy.toString().replace("/artists/old-artist", "/artists/new-artist"),
  );
  assert.equal(
    apply(shared, sharedSpan).toString(),
    shared.toString().replace("/artists/old-artist", "/artists/new-artist"),
  );
});

test("locale files are never News reference update targets", () => {
  for (const locale of ["ja", "en"]) {
    assert.equal(
      findNewsReferenceSpan(
        `src/content/news/example/${locale}.md`,
        Buffer.from("link: /exhibitions/old-exhibition\n"),
        "exhibitions",
        "old-exhibition",
        "new-exhibition",
      ),
      undefined,
    );
  }
});

test("recognized routes with unsupported structure fail closed", () => {
  assert.throws(
    () =>
      findNewsReferenceSpan(
        "src/content/news/example/index.yaml",
        Buffer.from("link: /exhibitions/old-exhibition?from=x\n"),
        "exhibitions",
        "old-exhibition",
        "new-exhibition",
      ),
    NewsReferenceStructureError,
  );
});
