import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createWorksEditorDraft,
  validateWorksEditorDraft,
} from "./works-draft-state.ts";
import {
  readWorksEditorEntry,
  readWorksEditorState,
  WorksEditorEntryNotFoundError,
} from "./works-state.ts";

const validSource = `---
title: Test Work
artist: test-artist
images:
  - src: /images/test.jpg
    alt: Test image
size: H100 × W100 mm
material: Paper
year: 2026
inquiry:
  type: inquiry
---
Localized body
`;

async function fixture(source = validSource) {
  const root = await mkdtemp(path.join(tmpdir(), "works-editor-"));
  await writeFile(path.join(root, "test-work.md"), source);
  return root;
}

test("reads flat Markdown directly into a Works entry and list state", async () => {
  const root = await fixture();
  const entry = await readWorksEditorEntry("test-work", root);
  assert.equal(entry.data?.artist.id, "test-artist");
  assert.equal(entry.data?.images[0].src, "/images/test.jpg");
  assert.equal(entry.body, "Localized body");
  assert.deepEqual(
    (await readWorksEditorState(root)).entries.map(
      ({ contentId }) => contentId,
    ),
    ["test-work"],
  );
});

test("creates an immutable Works-specific Draft", async () => {
  const entry = await readWorksEditorEntry("test-work", await fixture());
  const draft = createWorksEditorDraft(entry);
  assert.ok(draft);
  draft.data.images[0].src = "/images/changed.jpg";
  assert.equal(entry.data?.images[0].src, "/images/test.jpg");
});

test("validates Drafts with canonical Work rules", async () => {
  const entry = await readWorksEditorEntry("test-work", await fixture());
  const draft = createWorksEditorDraft(entry);
  assert.ok(draft);
  draft.data.images.push(structuredClone(draft.data.images[0]));
  assert.match(
    validateWorksEditorDraft(draft)[0].messageKey,
    /Duplicate Work image path/,
  );
});

test("reports schema issues and rejects unsafe or unknown IDs", async () => {
  const root = await fixture(validSource.replace("year: 2026", "year: -1"));
  assert.equal(
    (await readWorksEditorEntry("test-work", root)).structuralStatus,
    "issues",
  );
  await assert.rejects(
    () => readWorksEditorEntry("../test-work", root),
    WorksEditorEntryNotFoundError,
  );
  await assert.rejects(
    () => readWorksEditorEntry("missing", root),
    WorksEditorEntryNotFoundError,
  );
});
