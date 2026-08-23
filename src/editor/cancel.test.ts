import assert from "node:assert/strict";
import test from "node:test";
import { restoreEditorDraftBaseline } from "./cancel.ts";

type ContractDraft = {
  shared: { title: string; visible: boolean };
  locales: { ja: { title: string }; en: { title: string } };
};

const draft = (): ContractDraft => ({
  shared: { title: "A", visible: false },
  locales: { ja: { title: "JA A" }, en: { title: "EN A" } },
});

test("Cancel restores every Shared, JA, and EN field from the saved baseline", () => {
  const baseline = draft();
  const edited = restoreEditorDraftBaseline(baseline);
  edited.shared = { title: "C", visible: true };
  edited.locales.ja.title = "JA C";
  edited.locales.en.title = "EN C";

  assert.deepEqual(restoreEditorDraftBaseline(baseline), draft());
  assert.notEqual(
    restoreEditorDraftBaseline(baseline),
    restoreEditorDraftBaseline(baseline),
  );
});

test("a successful Save replaces the Cancel baseline", () => {
  let baseline = draft();
  const saved = restoreEditorDraftBaseline(baseline);
  saved.shared.title = "B";
  saved.locales.ja.title = "JA B";
  baseline = restoreEditorDraftBaseline(saved);

  const later = restoreEditorDraftBaseline(baseline);
  later.shared.title = "C";
  assert.deepEqual(restoreEditorDraftBaseline(baseline), saved);
});

test("a failed Save leaves the Cancel baseline unchanged", () => {
  const baseline = draft();
  const failed = restoreEditorDraftBaseline(baseline);
  failed.shared.title = "failed";

  assert.deepEqual(restoreEditorDraftBaseline(baseline), draft());
});
