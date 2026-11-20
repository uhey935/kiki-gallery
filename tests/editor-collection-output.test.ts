import assert from "node:assert/strict";
import { access, readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { stripEditor } from "../scripts/production-output.mjs";

async function exists(candidate: string): Promise<boolean> {
  return access(candidate)
    .then(() => true)
    .catch(() => false);
}

async function htmlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(candidate)));
    else if (entry.name.endsWith(".html")) files.push(candidate);
  }
  return files;
}

test("generated collection pages expose Create only for create-capable families", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "kiki-editor-output-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const output = path.join(temp, "dist");
  const build = spawnSync(
    process.execPath,
    ["node_modules/astro/bin/astro.mjs", "build", "--outDir", output],
    { encoding: "utf8" },
  );
  assert.equal(
    build.status,
    0,
    `${build.error ?? ""}\n${build.stdout}\n${build.stderr}`,
  );
  const about = await readFile(
    path.join(output, "editor/about/index.html"),
    "utf8",
  );
  const home = await readFile(
    path.join(output, "editor/home/index.html"),
    "utf8",
  );
  const artists = await readFile(
    path.join(output, "editor/artists/index.html"),
    "utf8",
  );

  assert.doesNotMatch(about, /Create About|\/editor\/about\/create\//);
  assert.doesNotMatch(home, /Create Home|\/editor\/home\/create\//);
  assert.match(artists, /href="\/editor\/artists\/create\/"/);
  assert.equal(
    await exists(path.join(output, "editor/about/create/index.html")),
    false,
  );

  const editorHtml = await htmlFiles(path.join(output, "editor"));
  for (const file of editorHtml) {
    assert.doesNotMatch(
      await readFile(file, "utf8"),
      /href="\/editor\/about\/create\/?"/,
      file,
    );
  }
  // Compare raw Astro output to stripped output, without ever restoring Editor
  // files to production dist/. No content-count assumption is needed.
  const publicBefore = (await htmlFiles(output)).filter(
    (file) => !file.startsWith(path.join(output, "editor") + path.sep),
  );
  const bytes = new Map(
    await Promise.all(
      publicBefore.map(async (file) => [file, await readFile(file)] as const),
    ),
  );
  const result = await stripEditor(output, path.resolve("public"));
  assert.equal(result.publicPages, publicBefore.length);
  assert.deepEqual(await htmlFiles(output), publicBefore);
  for (const [file, original] of bytes)
    assert.deepEqual(await readFile(file), original, file);
  assert.equal(await exists(path.join(output, "editor")), false);
});

test("production output has no Editor HTML or links", async () => {
  assert.equal(await exists("dist/editor"), false);
  const pages = await htmlFiles("dist");
  assert.ok(pages.length > 0);
  for (const file of pages)
    assert.doesNotMatch(await readFile(file, "utf8"), /\/editor(?:\/|["'?#])/);
});
