import assert from "node:assert/strict";
import test from "node:test";

import type { JournalEditorDraftState } from "./journal-draft-state.ts";

import {
  editorFailureGuidance,
  flatIssueFieldCandidates,
  isEditorManualRecoveryFailure,
  isEditorSaveShortcut,
  journalDraftDirtyFields,
  journalIssueFieldName,
  journalIssueLocation,
  worksWorkspaceUxState,
} from "./ux.ts";

test("flat validation field guidance resolves nested Home controls", () => {
  assert.deepEqual(flatIssueFieldCandidates("sections.1.href"), [
    "sections.1.href",
    "sections_1_href",
    "section_1_href",
  ]);
});

test("Works workspace explains dirty, blocked, and unpublished states", () => {
  const dirty = worksWorkspaceUxState({
    collectionName: "Work",
    pending: null,
    dirty: true,
    canSave: true,
    canPreview: true,
    canPublish: true,
    savedSincePublish: false,
  });
  assert.equal(dirty.status, "Unsaved changes · save required before publish");
  assert.equal(dirty.publishTitle, "Save changes before publishing");
  const blocked = worksWorkspaceUxState({
    collectionName: "Work",
    pending: null,
    dirty: false,
    canSave: false,
    canPreview: false,
    canPublish: false,
    savedSincePublish: false,
  });
  assert.equal(blocked.status, "Saved · Publish blocked by validation");
  const unpublished = worksWorkspaceUxState({
    collectionName: "Work",
    pending: null,
    dirty: false,
    canSave: true,
    canPreview: true,
    canPublish: true,
    savedSincePublish: true,
  });
  assert.equal(
    unpublished.status,
    "Saved · unpublished changes ready to publish",
  );
  assert.equal(
    unpublished.publishTitle,
    "Publish the saved unpublished changes",
  );
});

test("canonical mismatch tells the operator to reload", () => {
  assert.deepEqual(editorFailureGuidance("canonical-mismatch"), {
    action: "reload",
    message: "The canonical files changed. Reload before continuing.",
  });
});

test("workspace save and publish tooltips name each flat collection", () => {
  for (const collectionName of [
    "Work",
    "Artist",
    "Exhibition",
    "News",
    "Home",
  ] as const) {
    const dirty = worksWorkspaceUxState({
      collectionName,
      pending: null,
      dirty: true,
      canSave: true,
      canPreview: true,
      canPublish: true,
      savedSincePublish: false,
    });
    assert.equal(
      dirty.saveTitle,
      `Save changes to the canonical ${collectionName}`,
    );

    const saved = worksWorkspaceUxState({
      collectionName,
      pending: null,
      dirty: false,
      canSave: true,
      canPreview: true,
      canPublish: true,
      savedSincePublish: false,
    });
    assert.equal(
      saved.publishTitle,
      `Publish the saved canonical ${collectionName}`,
    );
  }
});

test("issue field names resolve the first actionable field across scopes", () => {
  assert.equal(
    journalIssueFieldName({
      ruleId: "content.locale.structure",
      severity: "error",
      category: "structure",
      locale: "en",
      messageKey: "invalid",
      params: { fields: "title,summary" },
    }),
    "en.title",
  );
  assert.equal(
    journalIssueFieldName({
      ruleId: "content.placeholder.unresolved",
      severity: "error",
      category: "content-quality",
      locale: "ja",
      fieldPath: "body",
      messageKey: "placeholder",
    }),
    "ja.body",
  );
  assert.equal(
    journalIssueFieldName({
      ruleId: "content.file.missing",
      severity: "error",
      category: "unit-integrity",
      locale: "en",
      messageKey: "missing",
    }),
    null,
  );
});

test("dirty fields preserve shared and locale draft responsibilities", () => {
  const initial: JournalEditorDraftState = {
    contentId: "entry",
    shared: {
      state: "editable",
      value: {
        date: "2026-01-01",
        category: "essay",
        hero: { image: "/a.jpg" },
        visibility: "public",
      },
    },
    locales: {
      ja: {
        state: "editable",
        value: { title: "JA", summary: "S", hero_alt: "A", body: "Body" },
      },
      en: {
        state: "editable",
        value: { title: "EN", summary: "S", hero_alt: "A", body: "Body" },
      },
    },
  };
  const current = structuredClone(initial);
  assert.equal(current.shared.state, "editable");
  assert.equal(current.locales.en.state, "editable");
  if (current.shared.state === "editable")
    current.shared.value.hero.image = "/b.jpg";
  if (current.locales.en.state === "editable")
    current.locales.en.value.body = "Changed";
  assert.deepEqual([...journalDraftDirtyFields(initial, current)].sort(), [
    "en.body",
    "shared.hero.image",
  ]);
});

test("validation failures point to review while infrastructure failures retry", () => {
  assert.equal(editorFailureGuidance("publish-blocked").action, "review");
  assert.equal(editorFailureGuidance("save-failed").action, "retry");
  assert.equal(editorFailureGuidance(undefined).action, "retry");
});

test("expired temporary assets tell the operator to upload again", () => {
  assert.deepEqual(editorFailureGuidance("asset-temp-expired"), {
    action: "review",
    message:
      "The temporary image is no longer available. Upload it again before saving.",
  });
});

test("rollback failure tells the operator to stop before another operation", () => {
  assert.deepEqual(editorFailureGuidance("journal-manual-recovery-required"), {
    action: "review",
    message:
      "Stop editing and request manual recovery before trying another operation.",
  });
  assert.deepEqual(editorFailureGuidance("asset-save-rollback-failed"), {
    action: "review",
    message:
      "Stop editing and request manual recovery before trying another operation.",
  });
  assert.deepEqual(editorFailureGuidance("journal-save-rollback-failed"), {
    action: "review",
    message:
      "Stop editing and request manual recovery before trying another operation.",
  });
  assert.deepEqual(editorFailureGuidance("journal-create-rollback-failed"), {
    action: "review",
    message:
      "Stop editing and request manual recovery before trying another operation.",
  });
});

test("flat Create rollback failure uses the same manual recovery boundary", () => {
  assert.equal(
    isEditorManualRecoveryFailure("collection-create-rollback-failed"),
    true,
  );
  assert.equal(
    editorFailureGuidance("unsafe-collection-root").action,
    "review",
  );
});

test("Works recovery-required state keeps every operation stopped", () => {
  const state = worksWorkspaceUxState({
    collectionName: "Work",
    pending: null,
    dirty: true,
    canSave: true,
    canPreview: true,
    canPublish: true,
    savedSincePublish: false,
    recoveryRequired: true,
  });
  assert.equal(state.status, "Operations stopped · manual recovery required");
  assert.match(state.saveTitle, /Manual recovery/);
  assert.match(state.previewTitle, /Manual recovery/);
  assert.match(state.publishTitle, /Manual recovery/);
});

test("issue location exposes locale and field with useful fallbacks", () => {
  assert.deepEqual(
    journalIssueLocation({
      ruleId: "content.locale.structure",
      severity: "error",
      category: "structure",
      locale: "en",
      messageKey: "content.locale.invalid",
      params: { fields: "title,description" },
    }),
    { locale: "EN", field: "title,description" },
  );
  assert.deepEqual(
    journalIssueLocation({
      ruleId: "content.shared.structure",
      severity: "error",
      category: "structure",
      messageKey: "content.shared.invalid",
    }),
    { locale: "Shared", field: "Source" },
  );
});

test("save shortcut accepts Command or Control plus S", () => {
  assert.equal(
    isEditorSaveShortcut({
      key: "s",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
    }),
    true,
  );
  assert.equal(
    isEditorSaveShortcut({
      key: "S",
      metaKey: false,
      ctrlKey: true,
      altKey: false,
    }),
    true,
  );
  assert.equal(
    isEditorSaveShortcut({
      key: "s",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    }),
    false,
  );
});
