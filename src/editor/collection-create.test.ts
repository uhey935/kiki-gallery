import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createArtistsEditorEntry,
  createExhibitionsEditorEntry,
  createNewsEditorEntry,
  createWorksEditorEntry,
} from "./collection-create.ts";
import { createArtistsEditorDraft } from "./artists-draft-state.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
import { createExhibitionsEditorDraft } from "./exhibitions-draft-state.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import {
  createFlatEditorEntry,
  FlatCreateError,
  type FlatCreateFileSystem,
} from "./flat-create.ts";
import { createNewsEditorDraft } from "./news-draft-state.ts";
import {
  createNewsThreeFileEntry,
  NewsCreateError,
  type NewsCreateFileSystem,
} from "./news-create.ts";
import { readNewsEditorEntry } from "./news-state.ts";
import { createWorksEditorDraft } from "./works-draft-state.ts";
import { readWorksEditorEntry } from "./works-state.ts";

const sourceRoots = {
  works: path.resolve("src/content/works"),
  artists: path.resolve("src/content/artists"),
  exhibitions: path.resolve("src/content/exhibitions"),
  news: path.resolve("src/content/news"),
};

async function firstId(root: string) {
  return (await fs.readdir(root))
    .find((name) => name.endsWith(".md"))!
    .slice(0, -3);
}

async function firstNewsId(root: string) {
  return (await fs.readdir(root, { withFileTypes: true })).find((entry) =>
    entry.isDirectory(),
  )!.name;
}

async function fixtures() {
  const work = createWorksEditorDraft(
    await readWorksEditorEntry(await firstId(sourceRoots.works)),
  )!;
  const artist = createArtistsEditorDraft(
    await readArtistsEditorEntry(await firstId(sourceRoots.artists)),
  )!;
  const exhibition = createExhibitionsEditorDraft(
    await readExhibitionsEditorEntry(await firstId(sourceRoots.exhibitions)),
  )!;
  const news = createNewsEditorDraft(
    await readNewsEditorEntry(await firstNewsId(sourceRoots.news)),
  )!;
  return [
    {
      name: "works",
      draft: { ...work, contentId: "new-work", sourceRaw: "" },
      create: createWorksEditorEntry,
    },
    {
      name: "artists",
      draft: { ...artist, contentId: "new-artist", sourceRaw: "" },
      create: createArtistsEditorEntry,
    },
    {
      name: "exhibitions",
      draft: { ...exhibition, contentId: "new-exhibition", sourceRaw: "" },
      create: createExhibitionsEditorEntry,
    },
    {
      name: "news",
      draft: { ...news, contentId: "new-news" },
      create: createNewsEditorEntry,
    },
  ] as const;
}

test("each create-capable collection first-saves its canonical unit", async (t) => {
  for (const fixture of await fixtures())
    await t.test(fixture.name, async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), `${fixture.name}-create-`),
      );
      try {
        const saved = await fixture.create(fixture.draft as never, { root });
        assert.equal(saved.contentId, fixture.draft.contentId);
        assert.deepEqual(await fs.readdir(root), [
          fixture.name === "news"
            ? fixture.draft.contentId
            : `${fixture.draft.contentId}.md`,
        ]);
        if (fixture.name === "news")
          assert.deepEqual(
            (await fs.readdir(path.join(root, fixture.draft.contentId))).sort(),
            ["en.md", "index.yaml", "ja.md"],
          );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
});

test("flat Create fails closed for invalid IDs and case-fold collisions", async () => {
  const fixture = (await fixtures())[3];
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "news-create-collision-"),
  );
  try {
    await fs.writeFile(path.join(root, "Existing-News.md"), "owned");
    for (const contentId of ["../escape", "existing-news"])
      await assert.rejects(
        fixture.create({ ...fixture.draft, contentId } as never, { root }),
        (error: unknown) =>
          error instanceof NewsCreateError &&
          ["invalid-content-id", "content-id-collision"].includes(error.code),
      );
    assert.equal(
      await fs.readFile(path.join(root, "Existing-News.md"), "utf8"),
      "owned",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a flat staged-write failure leaves no partial canonical entry", async () => {
  const fixture = (await fixtures())[0];
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "works-create-failure-"),
  );
  const failing: FlatCreateFileSystem = {
    ...fs,
    async writeFile() {
      throw new Error("injected write failure");
    },
  };
  try {
    await assert.rejects(
      fixture.create(fixture.draft as never, { root, fileSystem: failing }),
      (error: unknown) =>
        error instanceof FlatCreateError && error.code === "create-failed",
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a News staged-write failure leaves no partial canonical unit", async () => {
  const fixture = (await fixtures())[3];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-create-stage-"));
  let writes = 0;
  const failing: NewsCreateFileSystem = {
    ...fs,
    async writeFile(...args: Parameters<typeof fs.writeFile>) {
      if (++writes === 2) throw new Error("injected staged write failure");
      return fs.writeFile(...args);
    },
  };
  try {
    await assert.rejects(
      fixture.create(fixture.draft as never, { root, fileSystem: failing }),
      (error: unknown) =>
        error instanceof NewsCreateError && error.code === "create-failed",
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a News post-install reread failure removes the exact created unit", async () => {
  const fixture = (await fixtures())[3];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-create-reread-"));
  try {
    await assert.rejects(
      createNewsThreeFileEntry(fixture.draft, root, fs, async () => undefined),
      (error: unknown) =>
        error instanceof NewsCreateError && error.code === "canonical-mismatch",
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a News Create rollback failure preserves the installed evidence", async () => {
  const fixture = (await fixtures())[3];
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "news-create-rollback-"),
  );
  const failing: NewsCreateFileSystem = {
    ...fs,
    async rm(target, options) {
      if (path.basename(String(target)) === fixture.draft.contentId)
        throw new Error("injected rollback failure");
      return fs.rm(target, options);
    },
  };
  try {
    await assert.rejects(
      createNewsThreeFileEntry(
        fixture.draft,
        root,
        failing,
        async () => undefined,
      ),
      (error: unknown) =>
        error instanceof NewsCreateError &&
        error.code === "news-create-rollback-failed",
    );
    assert.deepEqual(
      (await fs.readdir(path.join(root, fixture.draft.contentId))).sort(),
      ["en.md", "index.yaml", "ja.md"],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("flat Create blocks invalid drafts before mutation", async () => {
  const fixture = (await fixtures())[3];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "news-create-invalid-"));
  try {
    await assert.rejects(
      fixture.create(
        {
          ...fixture.draft,
          data: { ...fixture.draft.data, title: "" },
        } as never,
        { root },
      ),
      (error: unknown) =>
        error instanceof NewsCreateError && error.code === "invalid-draft",
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a failed canonical reread rolls back only the exact created bytes", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "flat-create-rollback-"),
  );
  try {
    await assert.rejects(
      createFlatEditorEntry<{ contentId: string; value: string }>({
        collectionId: "example",
        collectionLabel: "Example",
        draft: { contentId: "new-example", value: "valid" },
        root,
        validate: () => true,
        serialize: ({ value }) => value,
        reread: async () => undefined,
      }),
      (error: unknown) =>
        error instanceof FlatCreateError && error.code === "canonical-mismatch",
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
