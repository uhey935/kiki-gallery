import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createArtistsEditorDraft } from "./artists-draft-state.ts";
import { TemporaryArtistsHeroAssetStore } from "./artists-hero-assets.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";
import {
  ArtistsPublishError,
  publishSavedArtistsEntry,
} from "./artists-publish.ts";
import { saveArtistsEditorDraftWithHero } from "./artists-save.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
import { ArtistsRenameError, planArtistsRename } from "./artists-rename.ts";
import { ArtistsDeleteError, planArtistsDelete } from "./artists-delete.ts";

const execFile = promisify(execFileCallback);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const otherPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function git(root: string, ...args: string[]) {
  return (
    await execFile("git", args, { cwd: root, encoding: "utf8" })
  ).stdout.trim();
}

async function repositoryFixture() {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "artists-hero-publish-"),
  );
  const repository = path.join(temporary, "work");
  const remote = path.join(temporary, "remote.git");
  const contentRoot = path.join(repository, "src/content/artists");
  const assetRoot = path.join(repository, "public/images/artists");
  await fs.mkdir(path.join(contentRoot, "test-artist"), { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  await fs.writeFile(
    path.join(contentRoot, "test-artist/index.yaml"),
    "sort_name: Test Artist\nhero:\n  image: /images/artists/test-artist.png\nmedium:\n  - Painting\n",
  );
  await fs.writeFile(
    path.join(contentRoot, "test-artist/ja.md"),
    "---\nname: Test\nmedium_label: Painting\nshort_bio: Bio\nhero_alt: JA alt\n---\n",
  );
  await fs.writeFile(
    path.join(contentRoot, "test-artist/en.md"),
    "---\nname: Test\nmedium_label: Painting\nshort_bio: Bio\nhero_alt: EN alt\n---\n",
  );
  await fs.writeFile(path.join(assetRoot, "test-artist.png"), png);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Editor Test");
  await git(repository, "config", "user.email", "editor@example.test");
  await git(repository, "add", "--", ".");
  await git(repository, "commit", "-m", "Initial");
  await git(temporary, "init", "--bare", remote);
  await git(repository, "remote", "add", "origin", remote);
  await git(repository, "push", "-u", "origin", "main");
  return { temporary, repository, remote, contentRoot, assetRoot };
}

test("Artists Publish commits saved Hero evidence and content as one exact unit", async () => {
  const value = await repositoryFixture();
  try {
    const store = await TemporaryArtistsHeroAssetStore.create({
      parentDirectory: value.temporary,
    });
    const baseline = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", value.contentRoot),
    )!;
    const temporary = await store.register({
      contentId: "test-artist",
      workspaceId: "workspace-1",
      originalFilename: "x.png",
      declaredMime: "image/png",
      bytes: otherPng,
      replaces: { src: baseline.data.hero.image, sha256: sha(png) },
    });
    const draft = structuredClone(baseline);
    draft.data.name = "Published Hero";
    const saved = await saveArtistsEditorDraftWithHero(
      draft,
      baseline,
      {
        kind: "temporary",
        token: temporary.token,
        workspaceId: "workspace-1",
        proposedSrc: temporary.proposedSrc,
        sha256: temporary.sha256,
        replaces: temporary.replaces,
      },
      {
        repositoryRoot: value.repository,
        root: value.contentRoot,
        assetRoot: value.assetRoot,
        store,
      },
    );
    await fs.writeFile(
      path.join(value.repository, "unrelated.txt"),
      "unrelated\n",
    );
    const result = await publishSavedArtistsEntry(
      saved,
      structuredClone(saved),
      false,
      value.repository,
      value.contentRoot,
    );
    assert.equal(result.state, "published");
    assert.deepEqual(
      (await git(value.repository, "show", "--format=", "--name-only", "HEAD"))
        .split("\n")
        .filter(Boolean)
        .sort(),
      [
        "public/images/artists/test-artist.png",
        "src/content/artists/test-artist/index.yaml",
      ],
    );
    assert.equal(
      await new HeroAssetPublishEvidenceStore(value.repository).read(
        "artists",
        "test-artist",
      ),
      undefined,
    );
    assert.match(
      await git(value.repository, "status", "--short"),
      /unrelated\.txt/,
    );
  } finally {
    await fs.rm(value.temporary, { recursive: true, force: true });
  }
});

test("Artists Publish blocks an unproven Hero change and recovers the exact failed push commit", async () => {
  const value = await repositoryFixture();
  try {
    const baseline = createArtistsEditorDraft(
      await readArtistsEditorEntry("test-artist", value.contentRoot),
    )!;
    await fs.writeFile(path.join(value.assetRoot, "test-artist.png"), otherPng);
    await assert.rejects(
      publishSavedArtistsEntry(
        baseline,
        baseline,
        false,
        value.repository,
        value.contentRoot,
      ),
      (error: unknown) =>
        error instanceof ArtistsPublishError &&
        error.code === "publish-evidence-missing",
    );
    await fs.writeFile(path.join(value.assetRoot, "test-artist.png"), png);
    const store = await TemporaryArtistsHeroAssetStore.create({
      parentDirectory: value.temporary,
    });
    const temporary = await store.register({
      contentId: "test-artist",
      workspaceId: "workspace-1",
      originalFilename: "x.png",
      declaredMime: "image/png",
      bytes: otherPng,
      replaces: { src: baseline.data.hero.image, sha256: sha(png) },
    });
    const saved = await saveArtistsEditorDraftWithHero(
      baseline,
      baseline,
      {
        kind: "temporary",
        token: temporary.token,
        workspaceId: "workspace-1",
        proposedSrc: temporary.proposedSrc,
        sha256: temporary.sha256,
        replaces: temporary.replaces,
      },
      {
        repositoryRoot: value.repository,
        root: value.contentRoot,
        assetRoot: value.assetRoot,
        store,
      },
    );
    await git(
      value.repository,
      "remote",
      "set-url",
      "origin",
      path.join(value.temporary, "missing.git"),
    );
    const failed = await publishSavedArtistsEntry(
      saved,
      saved,
      false,
      value.repository,
      value.contentRoot,
    );
    assert.equal(failed.state, "committed-push-failed");
    assert.equal(
      (
        await new HeroAssetPublishEvidenceStore(value.repository).read(
          "artists",
          "test-artist",
        )
      )?.commit,
      failed.commit,
    );
    await git(value.repository, "remote", "set-url", "origin", value.remote);
    const recovered = await publishSavedArtistsEntry(
      saved,
      saved,
      false,
      value.repository,
      value.contentRoot,
    );
    assert.equal(recovered.state, "published");
    assert.equal(recovered.commit, failed.commit);
    assert.equal(
      await git(value.remote, "rev-parse", "refs/heads/main"),
      failed.commit,
    );
  } finally {
    await fs.rm(value.temporary, { recursive: true, force: true });
  }
});

test("pending Artists Hero evidence blocks Rename and Delete with stable errors", async () => {
  const value = await repositoryFixture();
  try {
    const bytes = await fs.readFile(
      path.join(value.assetRoot, "test-artist.png"),
    );
    const content = await Promise.all(
      ["index.yaml", "ja.md", "en.md"].map(async (name) => {
        const file = `src/content/artists/test-artist/${name}`;
        const body = await fs.readFile(path.join(value.repository, file));
        return { path: file, sha256: sha(body), byteSize: body.byteLength };
      }),
    );
    await new HeroAssetPublishEvidenceStore(value.repository).write({
      version: 1,
      state: "pending",
      operation: "hero-asset-save",
      collection: "artists",
      contentId: "test-artist",
      content,
      assets: [
        {
          src: "/images/artists/test-artist.png",
          path: "public/images/artists/test-artist.png",
          sha256: sha(bytes),
          byteSize: bytes.byteLength,
          format: "png",
          mime: "image/png",
          width: 1,
          height: 1,
        },
      ],
      createdAt: new Date().toISOString(),
    });
    await assert.rejects(
      planArtistsRename({
        repositoryRoot: value.repository,
        sourceContentId: "test-artist",
        destinationContentId: "renamed-artist",
      }),
      (error: unknown) =>
        error instanceof ArtistsRenameError &&
        error.code === "pending-hero-publish-evidence",
    );
    await assert.rejects(
      planArtistsDelete({
        repositoryRoot: value.repository,
        contentId: "test-artist",
        backupRoot: "",
      }),
      (error: unknown) =>
        error instanceof ArtistsDeleteError &&
        error.code === "pending-hero-publish-evidence",
    );
  } finally {
    await fs.rm(value.temporary, { recursive: true, force: true });
  }
});
