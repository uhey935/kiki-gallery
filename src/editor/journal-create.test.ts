import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createJournalEditorEntry,
  createNewJournalDraft,
  JournalCreateError,
  type JournalCreateFileSystem,
} from "./journal-create.ts";
import { validateJournalEditorDraft } from "./journal-draft-state.ts";

function validDraft(contentId = "new-entry") {
  const draft = createNewJournalDraft(contentId);
  if (draft.shared.state !== "editable") assert.fail("shared unavailable");
  draft.shared.value = {
    visibility: "hidden",
    date: "2026-08-08",
    category: "essay",
    hero: { image: "/images/journal/example.jpg" },
  };
  for (const [locale, title] of [
    ["ja", "新しい記事"],
    ["en", "New article"],
  ] as const) {
    const source = draft.locales[locale];
    if (source.state !== "editable") assert.fail(`${locale} unavailable`);
    source.value = {
      title,
      summary: `${title} summary`,
      hero_alt: `${title} image`,
      body: `${title} body\n`,
    };
  }
  return draft;
}

test("new Journal starts hidden with no category selected", () => {
  const draft = createNewJournalDraft("new-entry");
  assert.equal(draft.shared.state, "editable");
  if (draft.shared.state !== "editable") return;
  assert.equal(draft.shared.value.visibility, "hidden");
  assert.equal(draft.shared.value.category, "");
  for (const locale of ["ja", "en"] as const) {
    const localized = draft.locales[locale];
    if (localized.state !== "editable") assert.fail(`${locale} unavailable`);
    assert.equal(localized.value.seo_title, undefined);
    assert.equal(localized.value.description, undefined);
  }
  assert.equal(validateJournalEditorDraft(draft).capabilities.save, false);
});

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-create-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("create atomically materializes and rereads one three-file unit", async () => {
  await withRoot(async (root) => {
    const draft = validDraft();
    const saved = await createJournalEditorEntry(draft, root);
    assert.deepEqual(saved, draft);
    assert.deepEqual((await fs.readdir(path.join(root, "new-entry"))).sort(), [
      "en.md",
      "index.yaml",
      "ja.md",
    ]);
    const shared = await fs.readFile(
      path.join(root, "new-entry", "index.yaml"),
      "utf8",
    );
    assert.doesNotMatch(shared, /^author:/m);
    assert.doesNotMatch(shared, /^credits:/m);
    for (const locale of ["ja", "en"] as const) {
      const localized = await fs.readFile(
        path.join(root, "new-entry", `${locale}.md`),
        "utf8",
      );
      assert.doesNotMatch(localized, /^seo_title:/m);
      assert.doesNotMatch(localized, /^description:/m);
    }
    assert.deepEqual(
      (await fs.readdir(root)).filter((name) =>
        name.startsWith(".journal-create-"),
      ),
      [],
    );
  });
});

test("create fails closed for invalid IDs and exact or case-fold collisions", async () => {
  await withRoot(async (root) => {
    await fs.mkdir(path.join(root, "Existing-Entry"));
    for (const contentId of ["../escape", "existing-entry"]) {
      await assert.rejects(
        createJournalEditorEntry(validDraft(contentId), root),
        (error: unknown) =>
          error instanceof JournalCreateError &&
          (error.code === "invalid-content-id" ||
            error.code === "content-id-collision"),
      );
    }
    assert.equal(
      await fs
        .stat(path.join(root, "Existing-Entry"))
        .then((stat) => stat.isDirectory()),
      true,
    );
  });
});

test("create rejects incomplete scaffolding before filesystem mutation", async () => {
  await withRoot(async (root) => {
    const draft = validDraft();
    if (draft.locales.en.state === "editable")
      draft.locales.en.value.title = "";
    await assert.rejects(
      createJournalEditorEntry(draft, root),
      (error: unknown) =>
        error instanceof JournalCreateError && error.code === "invalid-draft",
    );
    assert.deepEqual(await fs.readdir(root), []);
  });
});

test("a staged write failure leaves no partial canonical unit", async () => {
  await withRoot(async (root) => {
    let writes = 0;
    const failing: JournalCreateFileSystem = {
      ...fs,
      async writeFile(...args: Parameters<typeof fs.writeFile>) {
        writes += 1;
        if (writes === 2) throw new Error("injected write failure");
        return fs.writeFile(...args);
      },
    };
    await assert.rejects(
      createJournalEditorEntry(validDraft(), root, failing),
      (error: unknown) =>
        error instanceof JournalCreateError && error.code === "create-failed",
    );
    assert.deepEqual(await fs.readdir(root), []);
  });
});
