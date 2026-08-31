import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  JournalEditorEntryNotFoundError,
  readJournalEditorEntry,
  readJournalEditorState,
} from "./journal-state.ts";
import {
  createJournalEditorDraft,
  isJournalEditorDraftDirty,
  updateJournalEditorDraft,
  validateJournalEditorDraft,
} from "./journal-draft-state.ts";
import {
  JournalDraftNotSerializableError,
  serializeJournalEditorDraft,
} from "./journal-serializer.ts";
import { promises as fs } from "node:fs";
import os from "node:os";
import {
  JournalSaveError,
  saveJournalEditorDraft,
  type JournalSaveFileSystem,
} from "./journal-save.ts";
import {
  assertJournalMutationAdmitted,
  detectJournalManualRecovery,
  JournalManualRecoveryError,
} from "./journal-manual-recovery.ts";
import {
  createJournalPreviewModel,
  JournalPreviewError,
  JournalPreviewStore,
} from "./journal-preview.ts";

const fixtures = path.resolve("src/content-loaders/journal/fixtures");

test("read-only Journal Editor State keeps every three-file repository unit", async () => {
  const state = await readJournalEditorState(fixtures);

  assert.equal(state.entries.length, 5);
  assert.deepEqual(state.entries.map((entry) => entry.contentId).sort(), [
    "broken-shared",
    "draft",
    "missing-en",
    "placeholder-en",
    "valid-public",
  ]);

  const missing = state.entries.find(
    (entry) => entry.contentId === "missing-en",
  )!;
  assert.equal(missing.localeStatus.ja, "valid");
  assert.equal(missing.localeStatus.en, "missing");
  assert.equal(missing.capabilities.preview.ja, true);
  assert.equal(missing.capabilities.preview.en, false);
  assert.equal(missing.capabilities.publish, false);
});

test("resolves one read-only workspace state by Content ID", async () => {
  const entry = await readJournalEditorEntry("valid-public", fixtures);

  assert.equal(entry.contentId, "valid-public");
  assert.equal(entry.shared.state, "valid");
  assert.equal(entry.locales.ja.state, "valid");
  assert.equal(entry.locales.en.state, "valid");
  assert.deepEqual(entry.issues, []);
  assert.equal(entry.capabilities.preview.ja, true);
  assert.equal(entry.capabilities.publish, true);
  if (entry.shared.state === "valid") {
    assert.equal(entry.shared.value.category, "interview");
    assert.equal(entry.shared.value.visibility, "public");
  }
});

test("draft workspace can toggle to public as a dirty, valid draft", async () => {
  const initial = createJournalEditorDraft(
    await readJournalEditorEntry("draft", fixtures),
  );
  assert.equal(
    initial.shared.state === "editable" && initial.shared.value.visibility,
    "draft",
  );
  const edited = updateJournalEditorDraft(initial, (draft) => {
    if (draft.shared.state === "editable")
      draft.shared.value.visibility = "public";
  });
  assert.equal(isJournalEditorDraftDirty(initial, edited), true);
  assert.equal(validateJournalEditorDraft(edited).capabilities.save, true);
  assert.equal(validateJournalEditorDraft(edited).capabilities.publish, true);
});

test("rejects invalid and unknown workspace Content IDs explicitly", async () => {
  await assert.rejects(
    readJournalEditorEntry("../valid-public", fixtures),
    JournalEditorEntryNotFoundError,
  );
  await assert.rejects(
    readJournalEditorEntry("unknown-entry", fixtures),
    JournalEditorEntryNotFoundError,
  );
});

test("Editor summaries expose issues without importing a Production facade", async () => {
  const state = await readJournalEditorState(fixtures);
  const valid = state.entries.find(
    (entry) => entry.contentId === "valid-public",
  )!;
  const broken = state.entries.find(
    (entry) => entry.contentId === "broken-shared",
  )!;

  assert.equal(valid.structuralStatus, "valid");
  assert.equal(valid.issueCount, 0);
  assert.equal(valid.capabilities.publish, true);
  assert.equal(broken.title, "shared破損");
  assert.equal(broken.date, undefined);
  assert.equal(broken.structuralStatus, "issues");
  assert.ok(broken.issueCount > 0);
});

test("draft updates stay separate from the read-only entry state", async () => {
  const entry = await readJournalEditorEntry("valid-public", fixtures);
  const initial = createJournalEditorDraft(entry);
  const changed = updateJournalEditorDraft(initial, (draft) => {
    if (draft.locales.ja.state === "editable") {
      draft.locales.ja.value.title = "編集中のタイトル";
    }
  });

  assert.equal(entry.locales.ja.state, "valid");
  assert.equal(initial.locales.ja.state, "editable");
  if (
    entry.locales.ja.state === "valid" &&
    initial.locales.ja.state === "editable" &&
    changed.locales.ja.state === "editable"
  ) {
    assert.notEqual(
      entry.locales.ja.value.title,
      changed.locales.ja.value.title,
    );
    assert.notEqual(
      initial.locales.ja.value.title,
      changed.locales.ja.value.title,
    );
  }
  assert.equal(isJournalEditorDraftDirty(initial, initial), false);
  assert.equal(isJournalEditorDraftDirty(initial, changed), true);
});

test("draft validation evaluates edited values without filesystem mutation", async () => {
  const entry = await readJournalEditorEntry("valid-public", fixtures);
  const draft = updateJournalEditorDraft(
    createJournalEditorDraft(entry),
    (next) => {
      if (next.locales.en.state === "editable")
        next.locales.en.value.title = "";
    },
  );
  const validation = validateJournalEditorDraft(draft);

  assert.equal(validation.capabilities.preview.en, false);
  assert.equal(validation.capabilities.publish, false);
  assert.equal(validation.issues[0]?.ruleId, "content.locale.structure");
});

test("preview adapter creates a locale-isolated model from an unsaved draft", async () => {
  const draft = createJournalEditorDraft(
    await readJournalEditorEntry("valid-public", fixtures),
  );
  if (draft.locales.ja.state !== "editable") assert.fail("JA unavailable");
  if (draft.locales.en.state !== "editable") assert.fail("EN unavailable");
  draft.locales.ja.value.title = "未保存JA";
  draft.locales.en.value.title = "Unsaved EN";

  const preview = createJournalPreviewModel(draft, "ja");
  assert.equal(preview.localized.title, "未保存JA");
  assert.equal(preview.locale, "ja");
  assert.doesNotMatch(JSON.stringify(preview), /Unsaved EN/);
});

test("preview adapter follows locale capability gating without fallback", async () => {
  const missing = createJournalEditorDraft(
    await readJournalEditorEntry("missing-en", fixtures),
  );
  assert.equal(createJournalPreviewModel(missing, "ja").locale, "ja");
  assert.throws(
    () => createJournalPreviewModel(missing, "en"),
    (error: unknown) =>
      error instanceof JournalPreviewError && error.code === "preview-blocked",
  );
});

test("preview store rejects invalid, mismatched, and expired state", async () => {
  const draft = createJournalEditorDraft(
    await readJournalEditorEntry("valid-public", fixtures),
  );
  let now = 100;
  const store = new JournalPreviewStore(50, () => now);
  const token = store.create(createJournalPreviewModel(draft, "ja"));
  assert.equal(store.read(token, "ja").locale, "ja");
  assert.throws(() => store.read(token, "en"), JournalPreviewError);
  assert.throws(() => store.read("invalid", "ja"), JournalPreviewError);
  now = 150;
  assert.throws(
    () => store.read(token, "ja"),
    (error: unknown) =>
      error instanceof JournalPreviewError && error.code === "preview-expired",
  );

  const abandoned = store.create(createJournalPreviewModel(draft, "ja"));
  now = 201;
  store.create(createJournalPreviewModel(draft, "ja"));
  assert.throws(
    () => store.read(abandoned, "ja"),
    (error: unknown) =>
      error instanceof JournalPreviewError &&
      error.code === "preview-not-found",
  );
});

test("unchanged canonical entries serialize byte-for-byte across all nine units", async () => {
  const root = path.resolve("src/content/journal");
  const contentIds = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.equal(contentIds.length, 9);
  for (const contentId of contentIds) {
    const entry = await readJournalEditorEntry(contentId, root);
    const files = serializeJournalEditorDraft(createJournalEditorDraft(entry));

    for (const fileName of ["index.yaml", "ja.md", "en.md"] as const) {
      const canonical = await fs.readFile(
        path.join(root, contentId, fileName),
        "utf8",
      );
      assert.equal(files[fileName], canonical, `${contentId}/${fileName}`);
    }
  }
});

test("serializer preserves TODO tokens and keeps locale output isolated", async () => {
  const entry = await readJournalEditorEntry("valid-public", fixtures);
  const draft = createJournalEditorDraft(entry);
  if (draft.locales.ja.state !== "editable") assert.fail("JA unavailable");
  if (draft.locales.en.state !== "editable") assert.fail("EN unavailable");

  draft.locales.ja.value.title = "JA only";
  draft.locales.en.value.title = "__TODO_EN_TITLE__";
  const files = serializeJournalEditorDraft(draft);

  assert.match(files["ja.md"], /^title: JA only$/m);
  assert.doesNotMatch(files["ja.md"], /__TODO_EN_TITLE__/);
  assert.match(files["en.md"], /^title: __TODO_EN_TITLE__$/m);
  assert.doesNotMatch(files["en.md"], /JA only/);
});

test("localized metadata overrides save, reread, and omit cleared values", async () => {
  await withTemporaryJournal(async (root) => {
    const initial = createJournalEditorDraft(
      await readJournalEditorEntry("valid-public", root),
    );
    const edited = updateJournalEditorDraft(initial, (draft) => {
      if (draft.locales.ja.state === "editable") {
        draft.locales.ja.value.seo_title = "JA SEO title";
        draft.locales.ja.value.description = "JA SEO description";
      }
      if (draft.locales.en.state === "editable") {
        draft.locales.en.value.seo_title = "EN SEO title";
        draft.locales.en.value.description = "EN SEO description";
      }
    });
    const saved = await saveJournalEditorDraft(edited, initial, root);

    for (const locale of ["ja", "en"] as const) {
      const source = saved.locales[locale];
      if (source.state !== "editable") assert.fail(`${locale} unavailable`);
      assert.equal(source.value.seo_title, `${locale.toUpperCase()} SEO title`);
      assert.equal(
        source.value.description,
        `${locale.toUpperCase()} SEO description`,
      );
    }

    const cleared = updateJournalEditorDraft(saved, (draft) => {
      for (const locale of ["ja", "en"] as const) {
        const source = draft.locales[locale];
        if (source.state !== "editable") assert.fail(`${locale} unavailable`);
        source.value.seo_title = undefined;
        source.value.description = undefined;
      }
    });
    assert.equal(validateJournalEditorDraft(cleared).capabilities.save, true);
    const serialized = serializeJournalEditorDraft(cleared);
    for (const locale of ["ja", "en"] as const) {
      assert.doesNotMatch(serialized[`${locale}.md`], /^seo_title:/m);
      assert.doesNotMatch(serialized[`${locale}.md`], /^description:/m);
    }
  });
});

test("serializer writes singular category and never writes legacy categories", async () => {
  const draft = createJournalEditorDraft(
    await readJournalEditorEntry("valid-public", fixtures),
  );
  const shared = serializeJournalEditorDraft(draft)["index.yaml"];
  assert.match(shared, /^category: interview$/m);
  assert.doesNotMatch(shared, /^categories:/m);
  assert.doesNotMatch(shared, /^author:/m);
  assert.doesNotMatch(shared, /^credits:/m);
});

test("serializer rejects unavailable three-file sources explicitly", async () => {
  const entry = await readJournalEditorEntry("missing-en", fixtures);

  assert.throws(
    () => serializeJournalEditorDraft(createJournalEditorDraft(entry)),
    JournalDraftNotSerializableError,
  );
});

async function withTemporaryJournal(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "journal-save-"));
  try {
    await fs.cp(
      path.join(fixtures, "valid-public"),
      path.join(temporary, "valid-public"),
      {
        recursive: true,
      },
    );
    await run(temporary);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

test("save writes one canonical three-file unit and rereads a clean baseline", async () => {
  await withTemporaryJournal(async (root) => {
    const entry = await readJournalEditorEntry("valid-public", root);
    const initial = createJournalEditorDraft(entry);
    const edited = updateJournalEditorDraft(initial, (draft) => {
      if (draft.shared.state === "editable") {
        draft.shared.value.category = "report";
        draft.shared.value.visibility = "draft";
      }
      if (draft.locales.ja.state === "editable")
        draft.locales.ja.value.title = "保存済み";
      if (draft.locales.en.state === "editable")
        draft.locales.en.value.title = "Saved";
    });
    assert.equal(isJournalEditorDraftDirty(initial, edited), true);
    assert.equal(validateJournalEditorDraft(edited).capabilities.save, true);
    assert.equal(
      createJournalPreviewModel(edited, "ja").shared.visibility,
      "draft",
    );
    assert.equal(
      createJournalPreviewModel(edited, "en").shared.visibility,
      "draft",
    );

    const saved = await saveJournalEditorDraft(edited, initial, root);
    assert.equal(isJournalEditorDraftDirty(saved, saved), false);
    assert.deepEqual(
      saved,
      createJournalEditorDraft(
        await readJournalEditorEntry("valid-public", root),
      ),
    );
    if (saved.shared.state === "editable") {
      assert.equal(saved.shared.value.category, "report");
      assert.equal(saved.shared.value.visibility, "draft");
    }
    const expected = serializeJournalEditorDraft(edited);
    for (const fileName of ["index.yaml", "ja.md", "en.md"] as const) {
      assert.equal(
        await fs.readFile(path.join(root, "valid-public", fileName), "utf8"),
        expected[fileName],
      );
    }
  });
});

test("save rejects path traversal without touching files", async () => {
  await withTemporaryJournal(async (root) => {
    const draft = createJournalEditorDraft(
      await readJournalEditorEntry("valid-public", root),
    );
    draft.contentId = "../valid-public";
    await assert.rejects(
      saveJournalEditorDraft(draft, draft, root),
      (error: unknown) =>
        error instanceof JournalSaveError &&
        error.code === "invalid-content-id",
    );
  });
});

test("a replacement failure rolls already replaced files back", async () => {
  await withTemporaryJournal(async (root) => {
    const directory = path.join(root, "valid-public");
    const before = await Promise.all(
      ["index.yaml", "ja.md", "en.md"].map((fileName) =>
        fs.readFile(path.join(directory, fileName), "utf8"),
      ),
    );
    const draft = updateJournalEditorDraft(
      createJournalEditorDraft(
        await readJournalEditorEntry("valid-public", root),
      ),
      (next) => {
        if (next.locales.ja.state === "editable")
          next.locales.ja.value.title = "未保存";
      },
    );
    let stagedRenameCount = 0;
    const failingFileSystem: JournalSaveFileSystem = {
      ...fs,
      async rename(oldPath, newPath) {
        if (String(oldPath).includes("-stage")) {
          stagedRenameCount += 1;
          if (stagedRenameCount === 2) {
            const error = new Error(
              "injected rename failure",
            ) as NodeJS.ErrnoException;
            error.code = "EIO";
            throw error;
          }
        }
        await fs.rename(oldPath, newPath);
      },
    };

    await assert.rejects(
      saveJournalEditorDraft(
        draft,
        createJournalEditorDraft(
          await readJournalEditorEntry("valid-public", root),
        ),
        root,
        failingFileSystem,
      ),
      JournalSaveError,
    );
    const after = await Promise.all(
      ["index.yaml", "ja.md", "en.md"].map((fileName) =>
        fs.readFile(path.join(directory, fileName), "utf8"),
      ),
    );
    assert.deepEqual(after, before);
    assert.deepEqual(
      (await fs.readdir(directory)).filter((name) =>
        name.startsWith(".journal-save-"),
      ),
      [],
    );
  });
});

test("a rollback failure requires manual recovery", async () => {
  await withTemporaryJournal(async (root) => {
    const initial = createJournalEditorDraft(
      await readJournalEditorEntry("valid-public", root),
    );
    const edited = updateJournalEditorDraft(initial, (draft) => {
      if (draft.locales.ja.state === "editable")
        draft.locales.ja.value.title = "未保存";
    });
    let stagedRenameCount = 0;
    const failingFileSystem: JournalSaveFileSystem = {
      ...fs,
      async rename(oldPath, newPath) {
        if (String(oldPath).includes("-stage")) {
          stagedRenameCount += 1;
          if (stagedRenameCount === 2) throw new Error("save failure");
        }
        if (String(oldPath).includes("-backup"))
          throw new Error("rollback failure");
        await fs.rename(oldPath, newPath);
      },
    };

    await assert.rejects(
      saveJournalEditorDraft(edited, initial, root, failingFileSystem),
      (error: unknown) =>
        error instanceof JournalSaveError &&
        error.code === "journal-save-rollback-failed",
    );
    const recovery = await detectJournalManualRecovery("valid-public", root);
    assert.equal(recovery?.contentId, "valid-public");
    assert.match(recovery?.recoveryReference ?? "", /^src\/content\/journal\//);
    await assert.rejects(
      assertJournalMutationAdmitted("valid-public", root),
      (error: unknown) =>
        error instanceof JournalManualRecoveryError &&
        error.code === "journal-manual-recovery-required",
    );
  });
});

test("cleanup failure after replacement does not misreport a successful save", async () => {
  await withTemporaryJournal(async (root) => {
    const initial = createJournalEditorDraft(
      await readJournalEditorEntry("valid-public", root),
    );
    const edited = updateJournalEditorDraft(initial, (draft) => {
      if (draft.locales.en.state === "editable")
        draft.locales.en.value.title = "Saved despite cleanup failure";
    });
    const cleanupFailingFileSystem: JournalSaveFileSystem = {
      ...fs,
      async rm() {
        throw new Error("cleanup failure");
      },
    };

    const saved = await saveJournalEditorDraft(
      edited,
      initial,
      root,
      cleanupFailingFileSystem,
    );
    assert.deepEqual(saved, edited);
  });
});

test("save rejects a stale baseline without overwriting canonical files", async () => {
  await withTemporaryJournal(async (root) => {
    const initial = createJournalEditorDraft(
      await readJournalEditorEntry("valid-public", root),
    );
    const edited = updateJournalEditorDraft(initial, (draft) => {
      if (draft.locales.ja.state === "editable")
        draft.locales.ja.value.title = "Editor change";
    });
    const canonicalFile = path.join(root, "valid-public", "ja.md");
    await fs.appendFile(canonicalFile, "\nExternal change\n");

    await assert.rejects(
      saveJournalEditorDraft(edited, initial, root),
      (error: unknown) =>
        error instanceof JournalSaveError &&
        error.code === "canonical-mismatch",
    );
    assert.match(await fs.readFile(canonicalFile, "utf8"), /External change/);
  });
});

test("save follows save capability and permits content-quality TODO markers", async () => {
  await withTemporaryJournal(async (root) => {
    const initial = createJournalEditorDraft(
      await readJournalEditorEntry("valid-public", root),
    );
    const edited = updateJournalEditorDraft(initial, (draft) => {
      if (draft.locales.en.state === "editable")
        draft.locales.en.value.title = "__TODO_EN_TITLE__";
    });
    const validation = validateJournalEditorDraft(edited);
    assert.equal(validation.capabilities.save, true);
    assert.equal(validation.capabilities.publish, false);

    const saved = await saveJournalEditorDraft(edited, initial, root);
    assert.equal(saved.locales.en.state, "editable");
    assert.equal(validateJournalEditorDraft(saved).capabilities.publish, false);
  });
});
