import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createHomeEditorDraft,
  homeDirtyScopes,
  validateHomeEditorDraft,
} from "./home-draft-state.ts";
import { createHomePreviewModel, HomePreviewError } from "./home-preview.ts";
import { inspectHomePublish } from "./home-publish.ts";
import {
  saveHomeEditorDraft,
  writeHomeSerializedFiles,
  HomeSaveError,
} from "./home-save.ts";
import { serializeHomeEditorDraft } from "./home-serializer.ts";
import { readHomeEditorEntry, readHomeEditorState } from "./home-state.ts";
const execFile = promisify(execFileCallback);
const canonical = path.resolve("src/content/home/home");

async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "home-editor-"));
  const root = path.join(temporary, "home-root");
  await fs.mkdir(path.join(root, "home"), { recursive: true });
  await fs.cp(canonical, path.join(root, "home"), { recursive: true });
  return { temporary, root };
}

test("loads exact three-file singleton and copy states", async (t) => {
  const { temporary, root } = await fixture();
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const entry = await readHomeEditorEntry(root);
  assert.equal(entry.structuralStatus, "valid");
  assert.deepEqual(entry.copyStatus, { ja: "temporary", en: "placeholder" });
  assert.equal((await readHomeEditorState(root)).entries.length, 1);
  assert.deepEqual(
    Object.keys(serializeHomeEditorDraft(createHomeEditorDraft(entry))).sort(),
    ["en.md", "index.yaml", "ja.md"],
  );
});

test("missing, extra, malformed, symlink, and legacy flat fail closed", async (t) => {
  const { temporary, root } = await fixture();
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "home", "extra"), "x");
  assert.equal((await readHomeEditorEntry(root)).structuralStatus, "issues");
  await fs.rm(path.join(root, "home", "extra"));
  await fs.writeFile(path.join(root, "home", "ja.md"), "bad");
  assert.equal((await readHomeEditorEntry(root)).structuralStatus, "issues");
  await fs.rm(path.join(root, "home", "ja.md"));
  await fs.symlink(
    path.join(root, "home", "en.md"),
    path.join(root, "home", "ja.md"),
  );
  assert.equal((await readHomeEditorEntry(root)).structuralStatus, "issues");
  await fs.writeFile(path.join(root, "home.md"), "legacy");
  await assert.rejects(readHomeEditorEntry(root), /Mixed flat/);
});

test("Shared, JA, and EN dirty scopes are independent", async (t) => {
  const { temporary, root } = await fixture();
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const baseline = createHomeEditorDraft(await readHomeEditorEntry(root));
  const draft = structuredClone(baseline);
  assert.deepEqual(homeDirtyScopes(baseline, draft), {
    shared: false,
    ja: false,
    en: false,
  });
  if (draft.locales.ja.state === "editable")
    draft.locales.ja.value.about_intro = "JA final";
  draft.copyStatus.ja = "approved";
  assert.deepEqual(homeDirtyScopes(baseline, draft), {
    shared: false,
    ja: true,
    en: false,
  });
});

test("JA temporary previews, EN placeholder blocks, and resolved EN previews without fallback", async (t) => {
  const { temporary, root } = await fixture();
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const draft = createHomeEditorDraft(await readHomeEditorEntry(root));
  assert.equal(
    createHomePreviewModel(draft, "ja").localized.about_intro.includes("KiKi"),
    true,
  );
  assert.throws(
    () => createHomePreviewModel(draft, "en"),
    (error) =>
      error instanceof HomePreviewError && error.code === "preview-blocked",
  );
  if (draft.locales.en.state === "editable")
    draft.locales.en.value.about_intro = "Human EN fixture";
  draft.copyStatus.en = "approved";
  const en = createHomePreviewModel(draft, "en");
  assert.equal(en.localized.about_intro, "Human EN fixture");
  assert.equal(en.destinations.about, "/en/about/");
});

test("atomic Save supports localized draft status and preserves all three baselines", async (t) => {
  const { temporary, root } = await fixture();
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const baseline = createHomeEditorDraft(await readHomeEditorEntry(root));
  const draft = structuredClone(baseline);
  if (draft.locales.ja.state === "editable")
    draft.locales.ja.value.about_intro = "Formal JA fixture";
  draft.copyStatus.ja = "approved";
  const saved = await saveHomeEditorDraft(draft, baseline, root);
  assert.equal(saved.copyStatus.ja, "approved");
  assert.doesNotMatch(
    await fs.readFile(path.join(root, "home", "ja.md"), "utf8"),
    /TODO_HOME_JA/,
  );
});

test("Save refuses drift in every canonical file", async (t) => {
  for (const name of ["index.yaml", "ja.md", "en.md"] as const) {
    const { temporary, root } = await fixture();
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    const baseline = createHomeEditorDraft(await readHomeEditorEntry(root));
    await fs.appendFile(path.join(root, "home", name), "# drift\n");
    await assert.rejects(
      saveHomeEditorDraft(baseline, baseline, root),
      (error) =>
        error instanceof HomeSaveError && error.code === "canonical-mismatch",
    );
  }
});

test("partial install failure restores exact three-file preimages", async (t) => {
  const { temporary, root } = await fixture();
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const draft = createHomeEditorDraft(await readHomeEditorEntry(root));
  const files = serializeHomeEditorDraft(draft);
  const before = Object.fromEntries(
    await Promise.all(
      Object.keys(files).map(async (name) => [
        name,
        await fs.readFile(path.join(root, "home", name)),
      ]),
    ),
  );
  let installs = 0;
  await assert.rejects(
    writeHomeSerializedFiles(files, files, root, {
      ...fs,
      rename: async (from, to) => {
        if (String(from).includes("-stage") && ++installs === 2)
          throw new Error("injected");
        return fs.rename(from, to);
      },
    }),
    /Failed to save/,
  );
  for (const [name, bytes] of Object.entries(before))
    assert.deepEqual(await fs.readFile(path.join(root, "home", name)), bytes);
});

test("Publish inspection is exact three-file evidence and excludes flat Home", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "home-publish-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporary, "src/content/home"), { recursive: true });
  await fs.cp(canonical, path.join(temporary, "src/content/home/home"), {
    recursive: true,
  });
  await execFile("git", ["init", "-b", "main"], { cwd: temporary });
  await execFile("git", ["config", "user.name", "Test"], { cwd: temporary });
  await execFile("git", ["config", "user.email", "test@example.test"], {
    cwd: temporary,
  });
  await execFile("git", ["add", "."], { cwd: temporary });
  await execFile("git", ["commit", "-m", "initial"], { cwd: temporary });
  await fs.appendFile(
    path.join(temporary, "src/content/home/home/ja.md"),
    "# edit\n",
  );
  const fakeGit = async (args: string[]) => {
    if (args[0] === "symbolic-ref") return "main";
    if (args.includes("@{upstream}")) return "origin/main";
    return (
      await execFile("git", args, { cwd: temporary, encoding: "utf8" })
    ).stdout.trim();
  };
  const inspection = await inspectHomePublish(temporary, fakeGit);
  assert.deepEqual(inspection.files, [
    "src/content/home/home/en.md",
    "src/content/home/home/index.yaml",
    "src/content/home/home/ja.md",
  ]);
  assert.ok(inspection.files.every((file) => !file.endsWith("home.md")));
});

test("singleton lifecycle exposes no Create Rename or Delete", async () => {
  const registry = await import("./collection-registry.ts");
  assert.equal(registry.editorCollectionRegistry.home.id, "home");
  assert.equal("create" in registry.editorCollectionRegistry.home, false);
  assert.equal("rename" in registry.editorCollectionRegistry.home, false);
  assert.equal("delete" in registry.editorCollectionRegistry.home, false);
  assert.equal(
    validateHomeEditorDraft(createHomeEditorDraft(await readHomeEditorEntry()))
      .capabilities.save,
    true,
  );
});
