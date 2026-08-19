import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  resolveProjectPublicRoot,
  resolvePublicAssetPath,
  validatePublicImages,
} from "../../content-boundaries/public-image-validation.ts";
import { isAboutWatchedPath } from "./astro-loader.ts";

test("About watcher ignores generated and unrelated repository events", () => {
  const root = "/project/src/content/about";
  const publicRoot = "/project/public";
  assert.equal(
    isAboutWatchedPath("/project/.astro/content-assets.mjs", root, publicRoot),
    false,
  );
  assert.equal(
    isAboutWatchedPath(
      "/project/src/content/about/about/ja.md",
      root,
      publicRoot,
    ),
    true,
  );
  assert.equal(
    isAboutWatchedPath(
      "/project/public/images/about/about-01.jpg",
      root,
      publicRoot,
    ),
    true,
  );
  assert.equal(
    isAboutWatchedPath(
      "/project/public/images/about-sibling/file.jpg",
      root,
      publicRoot,
    ),
    false,
  );
});

test("formal image validation decodes bytes, verifies format and dimensions", async (t) => {
  const projectRoot = path.resolve(import.meta.dirname, "../../..");
  const publicRoot = resolveProjectPublicRoot(projectRoot);
  assert.equal(publicRoot, path.join(projectRoot, "public"));
  const valid = await validatePublicImages(
    publicRoot,
    ["/images/about/about-hero.jpg"],
    ["jpeg"],
  );
  assert.equal(valid.valid, true);

  await t.test(
    "malformed bytes are rejected independently of extension",
    async () => {
      const directory = await mkdtemp(
        path.join(process.env.TMPDIR ?? "/tmp", "about-image-"),
      );
      await writeFile(path.join(directory, "fake.jpg"), "not an image");
      const invalid = await validatePublicImages(
        directory,
        ["/fake.jpg"],
        ["jpeg"],
      );
      assert.equal(invalid.valid, false);
      assert.equal(invalid.issues[0]?.code, "asset-invalid");
      assert.equal(
        invalid.issues[0]?.filePath,
        path.join(directory, "fake.jpg"),
      );
    },
  );

  await t.test("traversal outside the public root is rejected", async () => {
    const resolved = resolvePublicAssetPath(publicRoot, "/../package.json");
    assert.equal(resolved.insideRoot, false);
    const invalid = await validatePublicImages(
      publicRoot,
      ["/../package.json"],
      ["jpeg"],
    );
    assert.equal(invalid.valid, false);
    assert.equal(invalid.issues[0]?.code, "asset-unsafe");
  });
});
