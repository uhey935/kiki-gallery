import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAboutEditorDraft } from "./about-draft-state.ts";
import {
  AboutSaveError,
  saveAboutEditorDraft,
  type AboutSaveFileSystem,
} from "./about-save.ts";
import { readAboutEditorEntry } from "./about-state.ts";
const source = path.resolve("src/content/about/about"),
  names = ["index.yaml", "ja.md", "en.md"] as const;
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "about-save-")),
    unit = path.join(root, "about");
  await fs.mkdir(unit);
  for (const name of names)
    await fs.copyFile(path.join(source, name), path.join(unit, name));
  return {
    root,
    unit,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}
const bytes = async (unit: string) =>
  Promise.all(names.map((name) => fs.readFile(path.join(unit, name), "utf8")));

test("atomic Save handles shared, JA, EN and multi-scope edits", async (t) => {
  for (const scope of ["shared", "ja", "en", "all"] as const)
    await t.test(scope, async () => {
      const f = await fixture();
      try {
        const baseline = createAboutEditorDraft(
            await readAboutEditorEntry(f.root),
          ),
          draft = structuredClone(baseline);
        if (
          (scope === "shared" || scope === "all") &&
          draft.shared.state === "editable"
        )
          draft.shared.value.contact = { email: "hello@kiki.gallery" };
        if (
          (scope === "ja" || scope === "all") &&
          draft.locales.ja.state === "editable"
        )
          draft.locales.ja.value.description = "レビュー";
        if (
          (scope === "en" || scope === "all") &&
          draft.locales.en.state === "editable"
        )
          draft.locales.en.value.description = "Unresolved";
        const saved = await saveAboutEditorDraft(draft, baseline, f.root);
        assert.equal(saved.contentId, "about");
      } finally {
        await f.cleanup();
      }
    });
});

test("preimage drift refuses before mutation", async () => {
  const f = await fixture();
  try {
    const baseline = createAboutEditorDraft(await readAboutEditorEntry(f.root)),
      before = await bytes(f.unit);
    await fs.appendFile(path.join(f.unit, "ja.md"), "\n");
    await assert.rejects(
      saveAboutEditorDraft(baseline, baseline, f.root),
      (e: unknown) =>
        e instanceof AboutSaveError && e.code === "canonical-mismatch",
    );
    assert.notDeepEqual(await bytes(f.unit), before);
  } finally {
    await f.cleanup();
  }
});

test("Save rejects a draft that references a missing About image", async () => {
  const f = await fixture();
  try {
    const baseline = createAboutEditorDraft(await readAboutEditorEntry(f.root)),
      draft = structuredClone(baseline);
    if (draft.shared.state !== "editable") assert.fail("shared unavailable");
    draft.shared.value.images.hero.src = "/images/about/missing.jpg";
    await assert.rejects(
      saveAboutEditorDraft(draft, baseline, f.root),
      (error: unknown) =>
        error instanceof AboutSaveError && error.code === "invalid-draft",
    );
  } finally {
    await f.cleanup();
  }
});

test("install failures at each canonical slot restore all preimages byte-exact", async (t) => {
  for (const failAt of [1, 2, 3])
    await t.test(`install ${failAt}`, async () => {
      const f = await fixture();
      try {
        const baseline = createAboutEditorDraft(
            await readAboutEditorEntry(f.root),
          ),
          draft = structuredClone(baseline),
          before = await bytes(f.unit);
        if (draft.locales.ja.state === "editable")
          draft.locales.ja.value.description = `failure ${failAt}`;
        let installs = 0;
        const io: AboutSaveFileSystem = {
          ...fs,
          rename: async (oldPath, newPath) => {
            if (String(oldPath).includes("-stage") && ++installs === failAt)
              throw new Error("injected install failure");
            return fs.rename(oldPath, newPath);
          },
        };
        await assert.rejects(
          saveAboutEditorDraft(draft, baseline, f.root, io),
          (e: unknown) =>
            e instanceof AboutSaveError && e.code === "save-failed",
        );
        assert.deepEqual(await bytes(f.unit), before);
      } finally {
        await f.cleanup();
      }
    });
});
