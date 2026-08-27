import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createArtistsEditorEntry,
  createExhibitionsEditorEntry,
  createNewsEditorEntry,
  createWorksEditorEntry,
} from "./collection-create.ts";
import { publishSavedArtistsEntry } from "./artists-publish.ts";
import { createArtistsEditorDraft } from "./artists-draft-state.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
import { publishSavedExhibitionsEntry } from "./exhibitions-publish.ts";
import { createExhibitionsEditorDraft } from "./exhibitions-draft-state.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import { publishSavedNewsEntry } from "./news-publish.ts";
import { createNewsEditorDraft } from "./news-draft-state.ts";
import { readNewsEditorEntry } from "./news-state.ts";
import { publishSavedWorksEntry } from "./works-publish.ts";
import { createWorksEditorDraft } from "./works-draft-state.ts";
import { readWorksEditorEntry } from "./works-state.ts";
import { materializeLegacyArtistsFixture } from "./test-flat-artists-fixture.ts";

const execFile = promisify(execFileCallback);
async function git(root: string, ...args: string[]) {
  return (
    await execFile("git", args, { cwd: root, encoding: "utf8" })
  ).stdout.trim();
}

test("first Save transitions every flat collection to Publish with its new untracked file", async (t) => {
  const fixtures = [
    [
      "works",
      "src/content/works",
      readWorksEditorEntry,
      createWorksEditorDraft,
      createWorksEditorEntry,
      publishSavedWorksEntry,
    ],
    [
      "artists",
      "src/content/artists",
      readArtistsEditorEntry,
      createArtistsEditorDraft,
      createArtistsEditorEntry,
      publishSavedArtistsEntry,
    ],
    [
      "exhibitions",
      "src/content/exhibitions",
      readExhibitionsEditorEntry,
      createExhibitionsEditorDraft,
      createExhibitionsEditorEntry,
      publishSavedExhibitionsEntry,
    ],
    [
      "news",
      "src/content/news",
      readNewsEditorEntry,
      createNewsEditorDraft,
      createNewsEditorEntry,
      publishSavedNewsEntry,
    ],
  ] as const;
  for (const [
    collection,
    relativeRoot,
    read,
    makeDraft,
    create,
    publish,
  ] of fixtures)
    await t.test(collection, async () => {
      const temporary = await fs.mkdtemp(
        path.join(os.tmpdir(), `${collection}-create-publish-`),
      );
      const repository = path.join(temporary, "work");
      const remote = path.join(temporary, "remote.git");
      const root = path.join(repository, relativeRoot);
      try {
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(path.join(repository, "baseline.txt"), "baseline\n");
        await git(repository, "init", "-b", "main");
        await git(repository, "config", "user.name", "Editor Test");
        await git(repository, "config", "user.email", "editor@example.test");
        await git(repository, "add", "--", ".");
        await git(repository, "commit", "-m", "Initial");
        await git(temporary, "init", "--bare", remote);
        await git(repository, "remote", "add", "origin", remote);
        await git(repository, "push", "-u", "origin", "main");

        const sourceRoot =
          collection === "artists"
            ? path.join(temporary, "legacy-artists-source")
            : path.resolve(relativeRoot);
        if (collection === "artists")
          await materializeLegacyArtistsFixture(sourceRoot);
        const sourceName = (
          await fs.readdir(sourceRoot, { withFileTypes: true })
        ).find((entry) =>
          collection === "works" ||
          collection === "news" ||
          collection === "artists" ||
          collection === "exhibitions"
            ? entry.isDirectory()
            : entry.isFile() && entry.name.endsWith(".md"),
        )?.name;
        assert.ok(sourceName);
        const sourceId =
          collection === "works" ||
          collection === "news" ||
          collection === "artists" ||
          collection === "exhibitions"
            ? sourceName
            : sourceName.slice(0, -3);
        const sourceDraft = makeDraft(
          (await read(sourceId, sourceRoot)) as never,
        );
        assert.ok(sourceDraft);
        if (collection === "news") {
          const localized = (sourceDraft as ReturnType<
            typeof createNewsEditorDraft
          >)!.locales.en;
          if (localized.state === "editable") {
            localized.value.title = "Publishable English title";
            localized.value.summary = "Publishable English summary";
          }
        }
        const contentId = `browser-new-${collection}`;
        if (collection === "artists" || collection === "exhibitions") {
          const heroSrc = collection === "artists"
            ? (sourceDraft as NonNullable<ReturnType<typeof createArtistsEditorDraft>>).data.hero.image
            : (sourceDraft as NonNullable<ReturnType<typeof createExhibitionsEditorDraft>>).shared.state === "editable"
              ? (sourceDraft as NonNullable<ReturnType<typeof createExhibitionsEditorDraft>> & { shared: { state: "editable"; value: { hero: { image: string } } } }).shared.value.hero.image
              : "";
          assert.ok(heroSrc);
          const asset = path.join(repository, `public${heroSrc}`);
          await fs.mkdir(path.dirname(asset), { recursive: true });
          await fs.copyFile(path.resolve(`public${heroSrc}`), asset);
          await git(repository, "add", "--", path.relative(repository, asset));
          await git(repository, "commit", "-m", `Add existing ${collection} Hero`);
          await git(repository, "push");
        }
        const saved = await create({ ...sourceDraft, contentId } as never, {
          root,
        });
        const expectedPaths =
          collection === "works" ||
          collection === "news" ||
          collection === "artists" ||
          collection === "exhibitions"
            ? ["en.md", "index.yaml", "ja.md"]
                .map((name) => `?? ${relativeRoot}/${contentId}/${name}`)
                .join("\n")
            : `?? ${relativeRoot}/${contentId}.md`;
        assert.equal(
          await git(repository, "status", "--short", "--untracked-files=all"),
          expectedPaths,
        );

        const result = await publish(
          saved as never,
          structuredClone(saved) as never,
          false,
          repository,
          root,
        );
        assert.equal(result.state, "published");
        const publishedPaths =
          collection === "works" ||
          collection === "news" ||
          collection === "artists" ||
          collection === "exhibitions"
            ? ["en.md", "index.yaml", "ja.md"]
                .map((name) => `${relativeRoot}/${contentId}/${name}`)
                .join("\n")
            : `${relativeRoot}/${contentId}.md`;
        assert.equal(
          await git(repository, "show", "--format=", "--name-only", "HEAD"),
          publishedPaths,
        );
        assert.equal(
          await git(remote, "rev-parse", "refs/heads/main"),
          result.commit,
        );
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    });
});
