import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { homeSchema } from "../content-schemas/home.ts";
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
import { inspectHomePublish } from "./home-publish.ts";
import { serializeHomeEditorDraft } from "./home-serializer.ts";
import { readHomeEditorEntry, readHomeEditorState } from "./home-state.ts";

const source = `---\nsections:\n  - id: artists\n    title: Artists\n    href: /artists\n    image:\n      src: /artists.jpg\n  - id: about\n    title: About\n    href: /about\n    image:\n      src: /about.jpg\n---\n`;
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
test("requires exactly one artists and about section with one image each", async () => {
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
test("schema rejects missing images and obsolete responsive variants", () => {
  const valid = {
    sections: [
      {
        id: "artists",
        title: "Artists",
        href: "/artists",
        image: { src: "/images/home/artists-square.jpg" },
      },
      {
        id: "about",
        title: "About",
        href: "/about",
        image: { src: "/images/home/about-landscape.jpg" },
      },
    ],
  };
  assert.equal(homeSchema.safeParse(valid).success, true);
  assert.equal(
    homeSchema.safeParse({
      ...valid,
      sections: [{ ...valid.sections[0], image: {} }, valid.sections[1]],
    }).success,
    false,
  );
  assert.equal(
    homeSchema.safeParse({
      ...valid,
      sections: [
        {
          ...valid.sections[0],
          image: {
            src: "/images/home/artists-square.jpg",
            square: "/legacy-square.jpg",
          },
        },
        valid.sections[1],
      ],
    }).success,
    false,
  );
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
          image: { src: "/artists.jpg" },
        },
        {
          id: "about" as const,
          title: "About",
          href: "/about",
          image: { src: "/about.jpg" },
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
test("canonical Home section and fallback assets exist", async () => {
  const root = path.resolve("public");
  for (const asset of [
    "/images/home/artists-square.jpg",
    "/images/home/about-landscape.jpg",
    "/images/home/fallback-hero.webp",
  ]) {
    assert.ok((await readFile(path.join(root, asset))).length > 0, asset);
  }
});
test("Publish inspection remains bound to canonical home.md", async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), "home-publish-"));
  try {
    const target = path.join(repository, "src/content/home/home.md");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
    const git = async (args: string[]) => {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") return repository;
      if (command === "symbolic-ref --quiet --short HEAD") return "main";
      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}")
        return "origin/main";
      if (command === "remote get-url origin") return "test-remote";
      if (command === "diff --cached --name-only -z") return "";
      if (command === "status --porcelain -- src/content/home/home.md")
        return " M src/content/home/home.md";
      throw new Error(`Unexpected Git command: ${command}`);
    };
    assert.deepEqual(await inspectHomePublish(repository, git), {
      branch: "main",
      remote: "origin",
      file: "src/content/home/home.md",
      commitMessage: "Publish home",
    });
  } finally {
    await rm(repository, { recursive: true });
  }
});
