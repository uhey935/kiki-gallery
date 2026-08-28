import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";

import {
  inspectJournalHeroCandidate,
  JournalHeroAssetError,
  TemporaryJournalHeroAssetStore,
  temporaryJournalHeroAssetStore,
} from "./journal-hero-assets.ts";
import { serveTemporaryJournalHero } from "./routes/journal-hero-preview-asset.ts";
import { handleJournalHeroUpload } from "./routes/journal-hero-asset-upload.ts";
import { createJournalEditorDraft } from "./journal-draft-state.ts";
import { readJournalEditorEntry } from "./journal-state.ts";
import { saveJournalEditorDraftWithHero } from "./journal-save.ts";
import {
  createJournalThreeFileEntryWithHero,
  createNewJournalDraft,
} from "./journal-create.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";
import { planJournalRename, JournalRenameError } from "./journal-rename.ts";
import { planJournalDelete, JournalDeleteError } from "./journal-delete.ts";
import { publishSavedJournalEntry, JournalPublishError } from "./journal-publish.ts";
import { validateJournalEditorDraft } from "./journal-draft-state.ts";
import { createJournalPreviewModel } from "./journal-preview.ts";

const execFile = promisify(execFileCallback);
async function git(root: string, ...args: string[]) {
  return (
    await execFile("git", args, { cwd: root, encoding: "utf8" })
  ).stdout.trim();
}

test("Journal Hero admits JPEG, PNG, WebP, and AVIF by decoded format", async () => {
  for (const [format, mime] of [
    ["jpg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
    ["avif", "image/avif"],
  ] as const) {
    const image = sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "white",
      },
    });
    const bytes = await (format === "jpg"
      ? image.jpeg()
      : format === "png"
        ? image.png()
        : format === "webp"
          ? image.webp()
          : image.avif()
    ).toBuffer();
    const admitted = inspectJournalHeroCandidate({
      contentId: "journal-entry",
      declaredMime: mime,
      bytes,
    });
    assert.equal(
      admitted.proposedSrc,
      `/images/journal/journal-entry.${format}`,
    );
  }
});

test("Journal Hero rejects invalid bytes, MIME mismatch, and unsafe identity", async () => {
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  for (const input of [
    { contentId: "../unsafe", declaredMime: "image/png", bytes: png },
    { contentId: "safe", declaredMime: "image/jpeg", bytes: png },
    { contentId: "safe", declaredMime: "image/png", bytes: new Uint8Array() },
  ])
    await assert.rejects(
      async () => inspectJournalHeroCandidate(input),
      (error: unknown) => error instanceof JournalHeroAssetError,
    );
});

test("Existing upload reuses same-byte canonical target and prompts for different bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-upload-collision-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const second = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "black" },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(root, "entry.png"), first);
  const requestFor = (bytes: Uint8Array) => {
    const form = new FormData();
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    form.append("file", new File([body], "desktop.png", { type: "image/png" }));
    form.append("workspaceId", "workspace-upload");
    return new Request("http://editor.test", { method: "POST", body: form });
  };
  const store = await TemporaryJournalHeroAssetStore.create();
  const reused = await handleJournalHeroUpload("entry", requestFor(first), {
    root,
    store,
    contentExists: () => true,
  });
  assert.equal((await reused.json()).state, "reuse");
  const replacement = await handleJournalHeroUpload("entry", requestFor(second), {
    root,
    store,
    contentExists: () => true,
  });
  const replacementBody = await replacement.json();
  assert.equal(replacementBody.state, "replace-confirmation");
  assert.deepEqual(await fs.readFile(path.join(root, "entry.png")), first);
});

test("temporary Journal Hero is owner-isolated, private, no-store, and releasable", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "journal-hero-test-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const store = await TemporaryJournalHeroAssetStore.create({
    parentDirectory: parent,
  });
  const asset = await store.register({
    contentId: "journal-entry",
    workspaceId: "workspace-a",
    originalFilename: "desktop-name.png",
    declaredMime: "image/png",
    bytes: png,
  });
  await assert.rejects(
    store.read(asset.token, "journal-entry", "workspace-b"),
  );
  const read = await store.read(asset.token, "journal-entry", "workspace-a");
  assert.equal(read.metadata.originalFilename, "desktop-name.png");
  await store.release(asset.token, "journal-entry", "workspace-a");
  await assert.rejects(
    store.read(asset.token, "journal-entry", "workspace-a"),
  );

  const missing = await serveTemporaryJournalHero({
    token: asset.token,
    contentId: "journal-entry",
    workspaceId: "workspace-a",
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "private, no-store");
});

test("temporary Preview is private/no-store and JA/EN share image with localized alt and shared caption", async () => {
  const bytes = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const store = await temporaryJournalHeroAssetStore;
  const asset = await store.register({
    contentId: "preview-entry",
    workspaceId: "preview-workspace",
    originalFilename: "preview.png",
    declaredMime: "image/png",
    bytes,
  });
  const response = await serveTemporaryJournalHero({
    token: asset.token,
    contentId: "preview-entry",
    workspaceId: "preview-workspace",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const draft = createNewJournalDraft("preview-entry");
  if (draft.shared.state !== "editable") return;
  draft.shared.value.date = "2026-08-28";
  draft.shared.value.category = "report";
  draft.shared.value.hero = {
    image: `/editor/api/journal-hero-preview/preview-entry/preview-workspace/${asset.token}`,
    hero_caption: "Shared caption",
  };
  for (const locale of ["ja", "en"] as const) {
    const source = draft.locales[locale];
    if (source.state !== "editable") continue;
    source.value.title = `${locale} title`;
    source.value.summary = `${locale} summary`;
    source.value.hero_alt = `${locale} alt`;
    source.value.body = `${locale} body`;
  }
  const ja = createJournalPreviewModel(draft, "ja");
  const en = createJournalPreviewModel(draft, "en");
  assert.equal(ja.shared.hero.image, en.shared.hero.image);
  assert.equal(ja.shared.hero.hero_caption, "Shared caption");
  assert.equal(en.shared.hero.hero_caption, "Shared caption");
  assert.equal(ja.localized.hero_alt, "ja alt");
  assert.equal(en.localized.hero_alt, "en alt");
  await store.release(asset.token, "preview-entry", "preview-workspace");
});

test("Remove is replacement-required and cannot pass Save/Create validation", async () => {
  const existing = createNewJournalDraft("remove-entry");
  if (existing.shared.state !== "editable") return;
  existing.shared.value.date = "2026-08-28";
  existing.shared.value.category = "report";
  existing.shared.value.hero.image = "";
  for (const locale of ["ja", "en"] as const) {
    const source = existing.locales[locale];
    if (source.state !== "editable") continue;
    source.value.title = "title";
    source.value.summary = "summary";
    source.value.hero_alt = "alt";
  }
  assert.equal(validateJournalEditorDraft(existing).capabilities.save, false);
});

test("Journal Existing/Create UI exposes managed Hero controls and target re-derivation", async () => {
  const [form, existing, create] = await Promise.all([
    fs.readFile(path.resolve("src/components/editor/EntryDraftForm.astro"), "utf8"),
    fs.readFile(path.resolve("src/pages/editor/journal/workspace/[contentId].astro"), "utf8"),
    fs.readFile(path.resolve("src/pages/editor/journal/create.astro"), "utf8"),
  ]);
  for (const marker of [
    "data-journal-hero-thumbnail",
    "data-journal-hero-drop",
    "data-journal-hero-select",
    "data-journal-hero-replace",
    "data-journal-hero-remove",
  ])
    assert.match(form, new RegExp(marker));
  assert.match(existing, /replace-confirmation/);
  assert.match(existing, /pagehide/);
  assert.match(create, /\/images\/journal\/\$\{current\.contentId\}/);
  assert.match(create, /createWorkspaceId/);
});

test("Existing Save materializes Hero and exact content with durable evidence", async (t) => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "journal-hero-save-"));
  t.after(() => fs.rm(repository, { recursive: true, force: true }));
  const contentRoot = path.join(repository, "src/content/journal");
  const assetRoot = path.join(repository, "public/images/journal");
  await fs.mkdir(contentRoot, { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  await fs.writeFile(path.join(assetRoot, "legacy-shared-1.jpg"), "legacy");
  await fs.cp(
    path.resolve("src/content-loaders/journal/fixtures/valid-public"),
    path.join(contentRoot, "valid-public"),
    { recursive: true },
  );
  const baseline = createJournalEditorDraft(
    await readJournalEditorEntry("valid-public", contentRoot),
  );
  const draft = structuredClone(baseline);
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const store = await TemporaryJournalHeroAssetStore.create();
  const asset = await store.register({
    contentId: "valid-public",
    workspaceId: "workspace-save",
    originalFilename: "ignored.png",
    declaredMime: "image/png",
    bytes: png,
  });
  assert.equal(draft.shared.state, "editable");
  if (draft.shared.state !== "editable") return;
  draft.shared.value.hero.image = asset.proposedSrc;
  const saved = await saveJournalEditorDraftWithHero(
    draft,
    baseline,
    {
      kind: "temporary",
      token: asset.token,
      workspaceId: "workspace-save",
      proposedSrc: asset.proposedSrc,
      sha256: asset.sha256,
    },
    { repositoryRoot: repository, root: contentRoot, assetRoot, store },
  );
  assert.equal(saved.shared.state, "editable");
  assert.deepEqual(await fs.readFile(path.join(assetRoot, "valid-public.png")), png);
  assert.equal(
    await fs.readFile(path.join(assetRoot, "legacy-shared-1.jpg"), "utf8"),
    "legacy",
  );
  assert.equal(
    (await new HeroAssetPublishEvidenceStore(repository).read(
      "journal",
      "valid-public",
    ))?.state,
    "pending",
  );
  await assert.rejects(
    store.read(asset.token, "valid-public", "workspace-save"),
  );
});

test("Existing evidence-finalization failure rolls content/asset back and retains candidate", async (t) => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "journal-hero-rollback-"));
  t.after(() => fs.rm(repository, { recursive: true, force: true }));
  const contentRoot = path.join(repository, "src/content/journal");
  const assetRoot = path.join(repository, "public/images/journal");
  await fs.mkdir(contentRoot, { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  await fs.cp(
    path.resolve("src/content-loaders/journal/fixtures/valid-public"),
    path.join(contentRoot, "valid-public"),
    { recursive: true },
  );
  const baseline = createJournalEditorDraft(
    await readJournalEditorEntry("valid-public", contentRoot),
  );
  const before = await Promise.all(
    ["index.yaml", "ja.md", "en.md"].map((name) =>
      fs.readFile(path.join(contentRoot, "valid-public", name), "utf8"),
    ),
  );
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const previous = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(assetRoot, "valid-public.png"), previous);
  const store = await TemporaryJournalHeroAssetStore.create();
  const asset = await store.register({
    contentId: "valid-public",
    workspaceId: "workspace-rollback",
    originalFilename: "candidate.png",
    declaredMime: "image/png",
    bytes: png,
    replaces: {
      src: "/images/journal/valid-public.png",
      sha256: createHash("sha256").update(previous).digest("hex"),
    },
  });
  const draft = structuredClone(baseline);
  if (draft.shared.state !== "editable") return;
  draft.shared.value.hero.image = asset.proposedSrc;
  class FailingEvidenceStore extends HeroAssetPublishEvidenceStore {
    override async write(): Promise<never> {
      throw new Error("injected evidence failure");
    }
  }
  await assert.rejects(
    saveJournalEditorDraftWithHero(
      draft,
      baseline,
      {
        kind: "temporary",
        token: asset.token,
        workspaceId: "workspace-rollback",
        proposedSrc: asset.proposedSrc,
        sha256: asset.sha256,
        replaces: asset.replaces,
      },
      {
        repositoryRoot: repository,
        root: contentRoot,
        assetRoot,
        store,
        evidenceStore: new FailingEvidenceStore(repository),
      },
    ),
  );
  assert.deepEqual(
    await fs.readFile(path.join(assetRoot, "valid-public.png")),
    previous,
  );
  assert.deepEqual(
    await Promise.all(
      ["index.yaml", "ja.md", "en.md"].map((name) =>
        fs.readFile(path.join(contentRoot, "valid-public", name), "utf8"),
      ),
    ),
    before,
  );
  assert.equal(
    (await store.read(asset.token, "valid-public", "workspace-rollback"))
      .metadata.sha256,
    asset.sha256,
  );
});

test("Create re-derives target, never overwrites a different asset, and records evidence", async (t) => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "journal-hero-create-"));
  t.after(() => fs.rm(repository, { recursive: true, force: true }));
  const contentRoot = path.join(repository, "src/content/journal");
  const assetRoot = path.join(repository, "public/images/journal");
  await fs.mkdir(contentRoot, { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  const workspace = "workspace-create";
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const store = await TemporaryJournalHeroAssetStore.create();
  const asset = await store.register({
    contentId: `create-${workspace}`,
    workspaceId: workspace,
    originalFilename: "desktop.png",
    declaredMime: "image/png",
    bytes: png,
  });
  const draft = createNewJournalDraft("new-journal");
  if (draft.shared.state !== "editable") return;
  draft.shared.value.date = "2026-08-28";
  draft.shared.value.category = "report";
  draft.shared.value.hero.image = "/images/journal/new-journal.png";
  for (const locale of ["ja", "en"] as const) {
    const source = draft.locales[locale];
    if (source.state !== "editable") continue;
    source.value.title = `${locale} title`;
    source.value.summary = `${locale} summary`;
    source.value.hero_alt = `${locale} alt`;
    source.value.body = `${locale} body`;
  }
  const saved = await createJournalThreeFileEntryWithHero(
    draft,
    {
      token: asset.token,
      createWorkspaceId: workspace,
      sha256: asset.sha256,
      format: "png",
    },
    { repositoryRoot: repository, root: contentRoot, assetRoot, store },
  );
  assert.equal(saved.contentId, "new-journal");
  assert.deepEqual(await fs.readFile(path.join(assetRoot, "new-journal.png")), png);
  assert.ok(
    await new HeroAssetPublishEvidenceStore(repository).read(
      "journal",
      "new-journal",
    ),
  );
});

test("Create evidence failure rolls unit/asset back and retains re-derived candidate", async (t) => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "journal-create-rollback-"));
  t.after(() => fs.rm(repository, { recursive: true, force: true }));
  const contentRoot = path.join(repository, "src/content/journal");
  const assetRoot = path.join(repository, "public/images/journal");
  await fs.mkdir(contentRoot, { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  const workspace = "workspace-rederive";
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "purple" },
  })
    .png()
    .toBuffer();
  const store = await TemporaryJournalHeroAssetStore.create();
  const asset = await store.register({
    contentId: `create-${workspace}`,
    workspaceId: workspace,
    originalFilename: "original-name.png",
    declaredMime: "image/png",
    bytes: png,
  });
  const draft = createNewJournalDraft("rederived-target");
  if (draft.shared.state !== "editable") return;
  draft.shared.value.date = "2026-08-28";
  draft.shared.value.category = "essay";
  draft.shared.value.hero.image = "/images/journal/rederived-target.png";
  for (const locale of ["ja", "en"] as const) {
    const source = draft.locales[locale];
    if (source.state !== "editable") continue;
    source.value.title = "title";
    source.value.summary = "summary";
    source.value.hero_alt = `${locale} alt`;
  }
  class FailingEvidenceStore extends HeroAssetPublishEvidenceStore {
    override async write(): Promise<never> {
      throw new Error("injected evidence failure");
    }
  }
  await assert.rejects(
    createJournalThreeFileEntryWithHero(
      draft,
      {
        token: asset.token,
        createWorkspaceId: workspace,
        sha256: asset.sha256,
        format: "png",
      },
      {
        repositoryRoot: repository,
        root: contentRoot,
        assetRoot,
        store,
        evidenceStore: new FailingEvidenceStore(repository),
      },
    ),
  );
  assert.equal(
    await fs.lstat(path.join(contentRoot, "rederived-target")).catch(() => undefined),
    undefined,
  );
  assert.equal(
    await fs.lstat(path.join(assetRoot, "rederived-target.png")).catch(() => undefined),
    undefined,
  );
  assert.equal(
    (
      await store.read(
        asset.token,
        `create-${workspace}`,
        workspace,
      )
    ).metadata.sha256,
    asset.sha256,
  );
});

test("Create checks only the current re-derived target and never carries Replace authorization", async (t) => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "journal-create-collision-"));
  t.after(() => fs.rm(repository, { recursive: true, force: true }));
  const contentRoot = path.join(repository, "src/content/journal");
  const assetRoot = path.join(repository, "public/images/journal");
  await fs.mkdir(contentRoot, { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  await fs.writeFile(path.join(assetRoot, "old-id.png"), "old target remains");
  await fs.writeFile(path.join(assetRoot, "new-id.png"), "different bytes");
  const workspace = "workspace-id-change";
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "orange" },
  })
    .png()
    .toBuffer();
  const store = await TemporaryJournalHeroAssetStore.create();
  const asset = await store.register({
    contentId: `create-${workspace}`,
    workspaceId: workspace,
    originalFilename: "candidate.png",
    declaredMime: "image/png",
    bytes: png,
  });
  const draft = createNewJournalDraft("new-id");
  if (draft.shared.state !== "editable") return;
  draft.shared.value.date = "2026-08-28";
  draft.shared.value.category = "report";
  draft.shared.value.hero.image = "/images/journal/new-id.png";
  for (const locale of ["ja", "en"] as const) {
    const source = draft.locales[locale];
    if (source.state !== "editable") continue;
    source.value.title = "title";
    source.value.summary = "summary";
    source.value.hero_alt = "alt";
  }
  await assert.rejects(
    createJournalThreeFileEntryWithHero(
      draft,
      {
        token: asset.token,
        createWorkspaceId: workspace,
        sha256: asset.sha256,
        format: "png",
      },
      { repositoryRoot: repository, root: contentRoot, assetRoot, store },
    ),
  );
  assert.equal(
    await fs.readFile(path.join(assetRoot, "old-id.png"), "utf8"),
    "old target remains",
  );
  assert.equal(
    await fs.readFile(path.join(assetRoot, "new-id.png"), "utf8"),
    "different bytes",
  );
  assert.ok(
    await store.read(asset.token, `create-${workspace}`, workspace),
  );
});

test("pending Hero evidence blocks Journal Rename and Delete", async (t) => {
  const repository = await fs.mkdtemp(path.join(os.tmpdir(), "journal-hero-guard-"));
  t.after(() => fs.rm(repository, { recursive: true, force: true }));
  await new HeroAssetPublishEvidenceStore(repository).write({
    version: 1,
    state: "pending",
    operation: "hero-asset-save",
    collection: "journal",
    contentId: "guarded-entry",
    content: [
      {
        path: "src/content/journal/guarded-entry/index.yaml",
        sha256: "a".repeat(64),
        byteSize: 1,
      },
    ],
    assets: [
      {
        src: "/images/journal/guarded-entry.png",
        path: "public/images/journal/guarded-entry.png",
        sha256: "b".repeat(64),
        byteSize: 1,
        format: "png",
        mime: "image/png",
        width: 1,
        height: 1,
      },
    ],
    createdAt: new Date().toISOString(),
  });
  await assert.rejects(
    planJournalRename({
      repositoryRoot: repository,
      sourceContentId: "guarded-entry",
      destinationContentId: "renamed-entry",
    }),
    (error: unknown) =>
      error instanceof JournalRenameError &&
      error.code === "canonical-mismatch",
  );
  await assert.rejects(
    planJournalDelete({
      repositoryRoot: repository,
      contentId: "guarded-entry",
      backupRoot: path.join(repository, "backup"),
    }),
    (error: unknown) =>
      error instanceof JournalDeleteError && error.code === "state-mismatch",
  );
});

test("Hero Publish stages exact evidence and retries only the recorded failed-push commit", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "journal-hero-publish-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const repository = path.join(temporary, "work");
  const remote = path.join(temporary, "remote.git");
  const contentRoot = path.join(repository, "src/content/journal");
  const assetRoot = path.join(repository, "public/images/journal");
  await fs.mkdir(contentRoot, { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  await fs.cp(
    path.resolve("src/content-loaders/journal/fixtures/valid-public"),
    path.join(contentRoot, "valid-public"),
    { recursive: true },
  );
  const index = path.join(contentRoot, "valid-public/index.yaml");
  await fs.writeFile(
    index,
    (await fs.readFile(index, "utf8")).replace(
      "/images/journal/interview-keisuke-matsuda-2026-02-1.jpg",
      "/images/journal/valid-public.png",
    ),
  );
  const original = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "black" },
  })
    .png()
    .toBuffer();
  const replacement = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "yellow" },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(assetRoot, "valid-public.png"), original);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Editor Test");
  await git(repository, "config", "user.email", "editor@example.test");
  await git(repository, "add", "--", ".");
  await git(repository, "commit", "-m", "Initial");
  await git(temporary, "init", "--bare", remote);
  await git(repository, "remote", "add", "origin", remote);
  await git(repository, "push", "-u", "origin", "main");
  const baseline = createJournalEditorDraft(
    await readJournalEditorEntry("valid-public", contentRoot),
  );
  await fs.writeFile(path.join(assetRoot, "valid-public.png"), replacement);
  await assert.rejects(
    publishSavedJournalEntry(baseline, false, repository, contentRoot),
    (error: unknown) => error instanceof JournalPublishError,
  );
  await fs.writeFile(path.join(assetRoot, "valid-public.png"), original);
  const store = await TemporaryJournalHeroAssetStore.create();
  const asset = await store.register({
    contentId: "valid-public",
    workspaceId: "workspace-publish",
    originalFilename: "replacement.png",
    declaredMime: "image/png",
    bytes: replacement,
    replaces: {
      src: "/images/journal/valid-public.png",
      sha256: createHash("sha256")
        .update(original)
        .digest("hex"),
    },
  });
  const saved = await saveJournalEditorDraftWithHero(
    baseline,
    baseline,
    {
      kind: "temporary",
      token: asset.token,
      workspaceId: "workspace-publish",
      proposedSrc: asset.proposedSrc,
      sha256: asset.sha256,
      replaces: asset.replaces,
    },
    { repositoryRoot: repository, root: contentRoot, assetRoot, store },
  );
  await git(repository, "remote", "set-url", "origin", path.join(temporary, "missing.git"));
  const failed = await publishSavedJournalEntry(saved, false, repository, contentRoot);
  assert.equal(failed.state, "committed-push-failed");
  assert.equal(
    (await new HeroAssetPublishEvidenceStore(repository).read("journal", "valid-public"))?.commit,
    failed.commit,
  );
  await git(repository, "remote", "set-url", "origin", remote);
  const recovered = await publishSavedJournalEntry(saved, false, repository, contentRoot);
  assert.equal(recovered.state, "published");
  assert.equal(recovered.commit, failed.commit);
  assert.equal(await git(remote, "rev-parse", "refs/heads/main"), failed.commit);
  assert.equal(
    await new HeroAssetPublishEvidenceStore(repository).read("journal", "valid-public"),
    undefined,
  );
});
