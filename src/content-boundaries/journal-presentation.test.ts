import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createJournalDetailPresentationModel } from "../components/journal-detail-presentation.ts";
import { createJournalEditorDraft } from "../editor/journal-draft-state.ts";
import { createJournalPreviewModel } from "../editor/journal-preview.ts";
import { readJournalEditorEntry } from "../editor/journal-state.ts";

const root = path.resolve("src");

test("Journal detail model keeps public and Preview structure locale-aware", () => {
  const shared = {
    hero: {
      image: "/images/journal/example.jpg",
      hero_caption: "Photo credit",
    },
    heroAlt: "Journal hero",
    title: "Journal title",
    date: "2026-08-22",
  };

  const ja = createJournalDetailPresentationModel({ locale: "ja", ...shared });
  const en = createJournalDetailPresentationModel({ locale: "en", ...shared });

  assert.deepEqual(ja.hero, {
    src: shared.hero.image,
    alt: shared.heroAlt,
    caption: shared.hero.hero_caption,
  });
  assert.equal(ja.title, shared.title);
  assert.equal(ja.date, shared.date);
  assert.equal(ja.publishedDate, "Saturday, Aug 22, 2026");
  assert.equal(ja.indexHref, "/journal/");
  assert.equal(en.indexHref, "/en/journal/");
});

test("unsaved JA and EN Preview drafts project through the shared detail model", async () => {
  const fixtures = path.join(root, "content-loaders/journal/fixtures");
  const draft = createJournalEditorDraft(
    await readJournalEditorEntry("valid-public", fixtures),
  );
  if (draft.locales.ja.state !== "editable") assert.fail("JA unavailable");
  if (draft.locales.en.state !== "editable") assert.fail("EN unavailable");

  draft.locales.ja.value.title = "未保存JAタイトル";
  draft.locales.ja.value.body = "未保存JA本文";
  draft.locales.en.value.title = "Unsaved EN title";
  draft.locales.en.value.body = "Unsaved EN body";

  for (const locale of ["ja", "en"] as const) {
    const localizedDraft = draft.locales[locale];
    if (localizedDraft.state !== "editable")
      assert.fail(`${locale.toUpperCase()} unavailable`);
    const preview = createJournalPreviewModel(draft, locale);
    const model = createJournalDetailPresentationModel({
      locale,
      hero: preview.shared.hero,
      heroAlt: preview.localized.hero_alt,
      title: preview.localized.title,
      date: preview.shared.date,
    });
    assert.equal(model.title, localizedDraft.value.title);
    assert.equal(preview.body, localizedDraft.value.body);
    assert.equal(model.locale, locale);
  }
});

test("public JA, public EN, and Preview use one Journal presentation component", async () => {
  const [component, ja, en, preview] = await Promise.all([
    fs.readFile(
      path.join(root, "components/JournalDetailPresentation.astro"),
      "utf8",
    ),
    fs.readFile(path.join(root, "pages/journal/[slug].astro"), "utf8"),
    fs.readFile(path.join(root, "pages/en/journal/[slug].astro"), "utf8"),
    fs.readFile(path.join(root, "editor/routes/journal-preview.astro"), "utf8"),
  ]);

  for (const route of [ja, en, preview]) {
    assert.match(route, /JournalDetailPresentation/);
    assert.match(route, /createJournalDetailPresentationModel/);
  }
  assert.match(component, /data-journal-detail-presentation/);
  assert.match(component, /<article class="article" lang=\{model\.locale\}>/);
  assert.match(component, /Published \{model\.publishedDate\}/);
  assert.match(component, /href=\{model\.indexHref\}/);
  assert.match(component, /<slot \/>/);
});

test("Journal public metadata is locale-symmetric and Preview metadata is isolated", async () => {
  const [ja, en, preview] = await Promise.all([
    fs.readFile(path.join(root, "pages/journal/[slug].astro"), "utf8"),
    fs.readFile(path.join(root, "pages/en/journal/[slug].astro"), "utf8"),
    fs.readFile(path.join(root, "editor/routes/journal-preview.astro"), "utf8"),
  ]);

  for (const route of [ja, en]) {
    assert.match(route, /title=\{item\.data\.title\}/);
    assert.match(route, /description=\{item\.data\.summary\}/);
    assert.match(route, /image=\{item\.data\.hero\.image\}/);
  }
  assert.match(preview, /robots="noindex,nofollow"/);
  assert.match(preview, /canonical=\{false\}/);
  assert.match(preview, /social=\{false\}/);
  assert.match(preview, /description=\{preview\.localized\.summary\}/);
});
