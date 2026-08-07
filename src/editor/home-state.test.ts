import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createHomeEditorDraft,
  validateHomeEditorDraft,
} from "./home-draft-state.ts";
import {
  createHomePreviewModel,
  HomePreviewError,
  HomePreviewStore,
} from "./home-preview.ts";
import { saveHomeEditorDraft, HomeSaveError } from "./home-save.ts";
import { serializeHomeEditorDraft } from "./home-serializer.ts";
import { readHomeEditorEntry, readHomeEditorState } from "./home-state.ts";

const source = `---\nsections:\n  - id: artists\n    title: Artists\n    href: /artists\n    image:\n      landscape: /artists-l.jpg\n      square: /artists-s.jpg\n      portrait: /artists-p.jpg\n  - id: about\n    title: About\n    href: /about\n    image:\n      landscape: /about-l.jpg\n      square: /about-s.jpg\n      portrait: /about-p.jpg\n---\n`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "home-editor-"));
  await writeFile(path.join(root, "home.md"), source);
  return root;
}
test("reads the one canonical Home and preserves clean serialization", async () => {
  const root = await fixture();
  try {
    assert.equal((await readHomeEditorState(root)).entries.length, 1);
    const draft = createHomeEditorDraft(await readHomeEditorEntry(root));
    assert.ok(draft);
    assert.equal(serializeHomeEditorDraft(draft), source);
  } finally {
    await rm(root, { recursive: true });
  }
});
test("requires exactly one artists and about section with nested variants", async () => {
  const root = await fixture();
  try {
    const draft = createHomeEditorDraft(await readHomeEditorEntry(root))!;
    draft.data.sections[1].id = "artists";
    const result = validateHomeEditorDraft(draft);
    assert.deepEqual(result.capabilities, {
      save: false,
      preview: false,
      publish: false,
    });
    assert.throws(
      () => createHomePreviewModel(draft),
      (error: unknown) =>
        error instanceof HomePreviewError && error.code === "preview-blocked",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save atomically replaces only canonical home.md", async () => {
  const root = await fixture();
  try {
    const baseline = createHomeEditorDraft(await readHomeEditorEntry(root))!;
    const draft = structuredClone(baseline);
    draft.data.sections[0].title = "Our Artists";
    const saved = await saveHomeEditorDraft(draft, baseline, root);
    assert.equal(saved.data.sections[0].title, "Our Artists");
    assert.match(
      await readFile(path.join(root, "home.md"), "utf8"),
      /Our Artists/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("Save refuses a stale baseline", async () => {
  const root = await fixture();
  try {
    const baseline = createHomeEditorDraft(await readHomeEditorEntry(root))!;
    const draft = structuredClone(baseline);
    draft.data.sections[0].title = "Draft";
    await writeFile(
      path.join(root, "home.md"),
      source.replace("Artists", "External"),
    );
    await assert.rejects(
      saveHomeEditorDraft(draft, baseline, root),
      (error: unknown) =>
        error instanceof HomeSaveError && error.code === "canonical-mismatch",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("preview tokens are Home-bound and expire", () => {
  let now = 0;
  const store = new HomePreviewStore(10, () => now);
  const model = {
    contentId: "home" as const,
    data: {
      sections: [
        {
          id: "artists" as const,
          title: "Artists",
          href: "/artists",
          image: { landscape: "/l", square: "/s", portrait: "/p" },
        },
        {
          id: "about" as const,
          title: "About",
          href: "/about",
          image: { landscape: "/l", square: "/s", portrait: "/p" },
        },
      ],
    },
  };
  const token = store.create(model);
  assert.equal(store.read(token, "home").contentId, "home");
  assert.throws(() => store.read(token, "other"));
  now = 10;
  assert.throws(
    () => store.read(token, "home"),
    (error: unknown) =>
      error instanceof HomePreviewError && error.code === "preview-expired",
  );
});
