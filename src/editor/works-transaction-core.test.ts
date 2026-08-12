import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PathLike } from "node:fs";
import { createWorksEditorDraft } from "./works-draft-state.ts";
import { createWorksPreviewModel } from "./works-preview.ts";
import {
  saveWorksEditorDraft,
  writeWorksSerializedUnit,
} from "./works-save.ts";
import { serializeWorksEditorUnit } from "./works-serializer.ts";
import { readWorksEditorEntry } from "./works-state.ts";
import { createWorksAssetPublishManifest } from "./works-asset-publish-manifest.ts";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "works-core-"));
  const id = "fixture-work";
  await fs.cp(
    path.resolve("src/content/works/yuka-mori-01"),
    path.join(root, id),
    { recursive: true },
  );
  return { root, id };
}

test("three-file Save edits JA while preserving Shared and EN ownership", async () => {
  const { root, id } = await fixture();
  try {
    const baseline = createWorksEditorDraft(
      await readWorksEditorEntry(id, root),
    )!;
    const draft = structuredClone(baseline);
    draft.data.title = "Edited JA";
    draft.body = "Statement";
    const saved = await saveWorksEditorDraft(draft, baseline, root);
    assert.equal(saved.data.title, "Edited JA");
    assert.equal(saved.localized?.en.title, "__TODO_WORK_TITLE__");
    assert.equal(saved.sourceFiles?.shared, baseline.sourceFiles?.shared);
    assert.match(saved.sourceFiles!.ja, /Edited JA/);
    assert.doesNotMatch(saved.sourceFiles!.shared, /alt:/);
    assert.doesNotMatch(saved.sourceFiles!.ja, /src:/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("three-file install rejects drift and restores exact preimages after partial install", async () => {
  const { root, id } = await fixture();
  try {
    const baseline = createWorksEditorDraft(
      await readWorksEditorEntry(id, root),
    )!;
    const draft = structuredClone(baseline);
    draft.data.title = "Changed";
    const serialized = serializeWorksEditorUnit(draft);
    await fs.appendFile(path.join(root, id, "ja.md"), "drift");
    await assert.rejects(
      writeWorksSerializedUnit(id, serialized, baseline.sourceFiles!, root),
      /changed/,
    );
    assert.equal(
      await fs.readFile(path.join(root, id, "index.yaml"), "utf8"),
      baseline.sourceFiles!.shared,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

for (const failInstall of [2, 3])
  test(`install failure ${failInstall} restores all three exact preimages`, async () => {
    const { root, id } = await fixture();
    try {
      const baseline = createWorksEditorDraft(
        await readWorksEditorEntry(id, root),
      )!;
      const draft = structuredClone(baseline);
      draft.data.title = `Install ${failInstall}`;
      let canonicalInstalls = 0;
      const fileSystem = {
        lstat: fs.lstat.bind(fs),
        readFile: fs.readFile.bind(fs),
        writeFile: fs.writeFile.bind(fs),
        rm: fs.rm.bind(fs),
        rename: async (from: PathLike, to: PathLike) => {
          const fromPath = String(from),
            toPath = String(to);
          if (
            fromPath.includes(".works-save-") &&
            !toPath.includes(".tmp") &&
            ++canonicalInstalls === failInstall
          )
            throw new Error("injected install failure");
          return fs.rename(from, to);
        },
      };
      await assert.rejects(
        writeWorksSerializedUnit(
          id,
          serializeWorksEditorUnit(draft),
          baseline.sourceFiles!,
          root,
          fileSystem,
        ),
        /Save failed/,
      );
      assert.deepEqual(
        createWorksEditorDraft(await readWorksEditorEntry(id, root))!
          .sourceFiles,
        baseline.sourceFiles,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

test("content rollback failure persists durable manual recovery evidence", async () => {
  const { root, id } = await fixture();
  try {
    const baseline = createWorksEditorDraft(
      await readWorksEditorEntry(id, root),
    )!;
    const draft = structuredClone(baseline);
    draft.data.title = "Recovery";
    draft.data.year = 2027;
    let installs = 0;
    const fileSystem = {
      lstat: fs.lstat.bind(fs),
      readFile: fs.readFile.bind(fs),
      writeFile: fs.writeFile.bind(fs),
      rm: fs.rm.bind(fs),
      rename: async (from: PathLike, to: PathLike) => {
        const source = String(from);
        if (source.includes(".works-save-") && ++installs === 2)
          throw new Error("install fail");
        if (source.includes(".works-rollback-"))
          throw new Error("rollback fail");
        return fs.rename(from, to);
      },
    };
    await assert.rejects(
      writeWorksSerializedUnit(
        id,
        serializeWorksEditorUnit(draft),
        baseline.sourceFiles!,
        root,
        fileSystem,
      ),
      (error: unknown) =>
        error instanceof Error && /recovery evidence/.test(error.message),
    );
    const evidence = JSON.parse(
      await fs.readFile(
        path.join(root, `.works-save-recovery-${id}.json`),
        "utf8",
      ),
    );
    assert.equal(evidence.status, "manual-recovery-required");
    assert.equal(evidence.failureCode, "content-rollback-failed");
    assert.equal(Object.keys(evidence.baseline).length, 3);
    assert.equal(Object.keys(evidence.observed).length, 3);
    assert.notEqual(
      evidence.observed[path.join(root, id, "index.yaml")].sha256,
      evidence.baseline[path.join(root, id, "index.yaml")].sha256,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Preview isolates JA from placeholder EN and Publish evidence names exactly three files", async () => {
  const { root, id } = await fixture();
  try {
    const draft = createWorksEditorDraft(await readWorksEditorEntry(id, root))!;
    assert.equal(
      createWorksPreviewModel(draft, undefined, "ja").data.title,
      draft.data.title,
    );
    assert.throws(
      () => createWorksPreviewModel(draft, undefined, "en"),
      /placeholder/,
    );
    const manifest = createWorksAssetPublishManifest(id, draft.sourceRaw, []);
    assert.deepEqual(manifest.contentPaths, [
      `src/content/works/${id}/index.yaml`,
      `src/content/works/${id}/ja.md`,
      `src/content/works/${id}/en.md`,
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
