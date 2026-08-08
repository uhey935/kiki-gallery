import assert from "node:assert/strict";
import test from "node:test";

import {
  renameEndpoint,
  renameFailureGuidance,
  renameWorkspaceUrl,
} from "./rename-ui.ts";

test("Rename browser routes remain limited to Journal and News", () => {
  assert.equal(renameEndpoint("journal"), "/editor/api/journal-rename");
  assert.equal(renameEndpoint("news"), "/editor/api/news-rename");
  assert.equal(
    renameWorkspaceUrl("journal", "renamed entry"),
    "/editor/journal/workspace/renamed%20entry/",
  );
});

test("Rename failures provide stable fail-closed browser guidance", () => {
  for (const code of [
    "invalid-content-id",
    "content-id-collision",
    "unresolved-references",
    "canonical-mismatch",
    "unsafe-journal-root",
    "unsafe-news-root",
    "unsafe-repository",
    "source-unavailable",
    "lock-conflict",
    "journal-rename-rollback-failed",
    "news-rename-rollback-failed",
  ])
    assert.notEqual(renameFailureGuidance(code), renameFailureGuidance());
});
