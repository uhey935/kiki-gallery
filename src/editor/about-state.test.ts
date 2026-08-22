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
import {
  AboutPreviewStore,
  createAboutPreviewModel,
  AboutPreviewError,
} from "./about-preview.ts";
import { readAboutEditorEntry } from "./about-state.ts";
import { serializeAboutEditorDraft } from "./about-serializer.ts";
import {
  discoverAboutImageAssets,
  validateAboutDraftAssets,
} from "./about-assets.ts";

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
  assert.equal(draft.shared.value.hours.status, "approved");
  assert.equal(draft.locales.ja.value.content_status, "approved");
  assert.equal(draft.locales.en.value.content_status, "approved");
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

test("current canonical assets pass production-equivalent Editor validation", async () => {
  const draft = createAboutEditorDraft(
    await readAboutEditorEntry(path.dirname(canonical)),
  );
  const validation = await validateAboutDraftAssets(draft);
  assert.equal(validation.valid, true);
  assert.deepEqual(await discoverAboutImageAssets(), [
    "/images/about/about-01.jpg",
    "/images/about/about-02.jpg",
    "/images/about/about-03.jpg",
    "/images/about/about-04.jpg",
    "/images/about/about-hero.jpg",
  ]);
});

test("About Editor asset validation rejects missing and non-JPEG images", async () => {
  const draft = createAboutEditorDraft(
    await readAboutEditorEntry(path.dirname(canonical)),
  );
  if (draft.shared.state !== "editable")
    assert.fail("shared About unavailable");
  draft.shared.value.images.hero.src = "/images/about/missing.jpg";
  const missing = await validateAboutDraftAssets(draft);
  assert.equal(missing.valid, false);
  assert.equal(missing.issues[0].code, "asset-missing");

  const publicRoot = await mkdtemp(path.join(tmpdir(), "about-assets-"));
  try {
    await mkdir(path.join(publicRoot, "images/about"), { recursive: true });
    await writeFile(
      path.join(publicRoot, "images/about/not-jpeg.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    draft.shared.value.images.hero.src = "/images/about/not-jpeg.png";
    const invalid = await validateAboutDraftAssets(draft, publicRoot);
    assert.equal(invalid.valid, false);
    assert.equal(invalid.issues[0].code, "asset-invalid");
  } finally {
    await rm(publicRoot, { recursive: true, force: true });
  }
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
  assert.equal(validateAboutEditorDraft(base).capabilities.preview.en, true);
  const pending = structuredClone(base);
  if (pending.shared.state === "editable")
    pending.shared.value.hours = { status: "pending" };
  if (pending.locales.ja.state === "editable")
    pending.locales.ja.value.content_status = "review";
  if (pending.locales.en.state === "editable") {
    pending.locales.en.value = {
      content_status: "placeholder",
      address: "__TODO_ABOUT_EN_ADDRESS__",
      images: {
        gallery: [1, 2, 3, 4].map((i) => ({
          alt: `__TODO_ABOUT_EN_ALT_${i}__`,
        })),
      },
      body: "__TODO_ABOUT_EN_STATEMENT__",
    };
  }
  assert.equal(validateAboutEditorDraft(pending).capabilities.preview.ja, true);
  assert.equal(validateAboutEditorDraft(pending).capabilities.publish, true);
  assert.equal(
    validateAboutEditorDraft(pending).capabilities.preview.en,
    false,
  );
  const en = structuredClone(pending);
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
    () => createAboutPreviewModel(pending, "en"),
    (e: unknown) =>
      e instanceof AboutPreviewError && e.code === "preview-blocked",
  );
  const approved = structuredClone(en);
  if (approved.shared.state === "editable")
    approved.shared.value.hours = {
      status: "approved",
      open_days: ["tue", "wed", "thu", "fri", "sat"],
      opens: "12:00",
      closes: "18:00",
    };
  assert.deepEqual(createAboutPreviewModel(approved, "en").hours, {
    label: "Open",
    value: "Tue, Wed, Thu, Fri, Sat 12:00–18:00",
    closedLabel: "Closed",
    closedValue: "Mon, Sun",
  });
  const bad = structuredClone(approved);
  if (bad.shared.state === "editable")
    bad.shared.value.contact = { map_url: "https://example.com" };
  assert.equal(validateAboutEditorDraft(bad).capabilities.save, false);
  if (bad.shared.state === "editable")
    bad.shared.value.hours = {
      status: "approved",
      open_days: ["mon"],
      opens: "18:00",
      closes: "12:00",
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
  assert.doesNotMatch(files["index.yaml"], /timezone|closed_days/);
  assert.doesNotMatch(files["ja.md"], /src:/);
  assert.match(files["ja.md"], /確認中/);
});

test("SEO UI fields retain the localized seo_title and description contract", async () => {
  const draft = createAboutEditorDraft(
    await readAboutEditorEntry(path.dirname(canonical)),
  );
  if (
    draft.locales.ja.state !== "editable" ||
    draft.locales.en.state !== "editable"
  )
    assert.fail("localized About sources must be editable");
  draft.locales.ja.value.seo_title = "JA SEO title";
  draft.locales.ja.value.description = "JA SEO description";
  draft.locales.en.value.seo_title = "EN SEO title";
  draft.locales.en.value.description = "EN SEO description";

  const files = serializeAboutEditorDraft(draft);
  assert.match(files["ja.md"], /seo_title: JA SEO title/);
  assert.match(files["ja.md"], /description: JA SEO description/);
  assert.match(files["en.md"], /seo_title: EN SEO title/);
  assert.match(files["en.md"], /description: EN SEO description/);
  assert.doesNotMatch(files["index.yaml"], /seo_title|description/);
});

test("preview tokens accept only their exact locale", async () => {
  const draft = createAboutEditorDraft(
    await readAboutEditorEntry(path.dirname(canonical)),
  );
  const model = createAboutPreviewModel(draft, "ja");
  const store = new AboutPreviewStore();
  const token = store.create(model);

  assert.equal(store.read(token, "ja").locale, "ja");
  assert.throws(
    () => store.read(token, "en"),
    (error: unknown) =>
      error instanceof AboutPreviewError && error.code === "preview-not-found",
  );
});
