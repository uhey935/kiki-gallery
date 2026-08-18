import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAboutEditorDraft,
  aboutDirtyScopes,
  validateAboutEditorDraft,
} from "./about-draft-state.ts";
import { createAboutPreviewModel, AboutPreviewError } from "./about-preview.ts";
import { readAboutEditorEntry } from "./about-state.ts";
import { serializeAboutEditorDraft } from "./about-serializer.ts";

const canonical = path.resolve("src/content/about/about");
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "about-editor-"));
  const unit = path.join(root, "about");
  await mkdir(unit);
  for (const name of ["index.yaml", "ja.md", "en.md"])
    await writeFile(
      path.join(unit, name),
      await readFile(path.join(canonical, name)),
    );
  return {
    root,
    unit,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("loads current exact singleton and hydrates independent scopes", async () => {
  const entry = await readAboutEditorEntry(path.dirname(canonical));
  const draft = createAboutEditorDraft(entry);
  assert.equal(entry.structuralStatus, "valid");
  assert.equal(draft.shared.state, "editable");
  if (
    draft.shared.state !== "editable" ||
    draft.locales.ja.state !== "editable" ||
    draft.locales.en.state !== "editable"
  )
    return;
  assert.equal(draft.shared.value.hours.status, "pending");
  assert.equal(draft.locales.ja.value.content_status, "review");
  assert.equal(draft.locales.en.value.content_status, "placeholder");
  assert.equal(draft.shared.value.images.gallery.length, 4);
  const changed = structuredClone(draft);
  if (changed.locales.ja.state === "editable")
    changed.locales.ja.value.address += " edit";
  assert.deepEqual(aboutDirtyScopes(draft, changed), {
    shared: false,
    ja: true,
    en: false,
  });
});

test("topology fails closed for extra and symlink files", async (t) => {
  for (const kind of ["extra", "symlink"] as const)
    await t.test(kind, async () => {
      const f = await fixture();
      try {
        if (kind === "extra")
          await writeFile(path.join(f.unit, "extra.md"), "x");
        else {
          await rm(path.join(f.unit, "en.md"));
          await symlink(
            path.join(canonical, "en.md"),
            path.join(f.unit, "en.md"),
          );
        }
        const entry = await readAboutEditorEntry(f.root);
        assert.equal(entry.structuralStatus, "issues");
      } finally {
        await f.cleanup();
      }
    });
});

test("validation covers hours, contacts, statuses, placeholders, body and alts", async () => {
  const base = createAboutEditorDraft(
    await readAboutEditorEntry(path.dirname(canonical)),
  );
  assert.equal(validateAboutEditorDraft(base).capabilities.preview.ja, true);
  assert.equal(validateAboutEditorDraft(base).capabilities.preview.en, false);
  const en = structuredClone(base);
  if (en.locales.en.state === "editable") {
    en.locales.en.value = {
      content_status: "review",
      address: "Yokohama",
      images: { gallery: [1, 2, 3, 4].map((i) => ({ alt: `Gallery ${i}` })) },
      body: "English statement",
    };
  }
  assert.equal(validateAboutEditorDraft(en).capabilities.preview.en, true);
  const model = createAboutPreviewModel(en, "en");
  assert.equal(model.body, "English statement");
  assert.equal(model.hours, undefined);
  assert.equal(model.contact, undefined);
  assert.equal(model.gallery[3].alt, "Gallery 4");
  assert.throws(
    () => createAboutPreviewModel(base, "en"),
    (e: unknown) =>
      e instanceof AboutPreviewError && e.code === "preview-blocked",
  );
  const approved = structuredClone(en);
  if (approved.shared.state === "editable")
    approved.shared.value.hours = {
      status: "approved",
      timezone: "Asia/Tokyo",
      open_days: ["tue", "wed", "thu", "fri", "sat"],
      opens: "12:00",
      closes: "18:00",
      closed_days: ["mon", "sun"],
    };
  assert.match(
    createAboutPreviewModel(approved, "en").hours?.value ?? "",
    /12:00/,
  );
  const bad = structuredClone(approved);
  if (bad.shared.state === "editable")
    bad.shared.value.contact = { map_url: "https://example.com" };
  assert.equal(validateAboutEditorDraft(bad).capabilities.save, false);
  if (bad.shared.state === "editable")
    bad.shared.value.hours = {
      status: "approved",
      timezone: "Asia/Tokyo",
      open_days: ["mon"],
      opens: "18:00",
      closes: "12:00",
      closed_days: ["mon"],
    };
  assert.equal(validateAboutEditorDraft(bad).capabilities.save, false);
});

test("serializer owns exactly shared src/hours/contact and localized alt/body", async () => {
  const draft = createAboutEditorDraft(
      await readAboutEditorEntry(path.dirname(canonical)),
    ),
    files = serializeAboutEditorDraft(draft);
  assert.deepEqual(Object.keys(files).sort(), ["en.md", "index.yaml", "ja.md"]);
  assert.doesNotMatch(files["index.yaml"], /alt:/);
  assert.doesNotMatch(files["ja.md"], /src:/);
  assert.match(files["ja.md"], /確認中/);
});
