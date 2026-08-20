import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

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

test("generated collection pages expose Create only for create-capable families", async () => {
  const about = await readFile("dist/editor/about/index.html", "utf8");
  const home = await readFile("dist/editor/home/index.html", "utf8");
  const artists = await readFile("dist/editor/artists/index.html", "utf8");

  assert.doesNotMatch(about, /Create About|\/editor\/about\/create\//);
  assert.doesNotMatch(home, /Create Home|\/editor\/home\/create\//);
  assert.match(artists, /href="\/editor\/artists\/create\/"/);
  assert.equal(await exists("dist/editor/about/create/index.html"), false);

  const editorHtml = await htmlFiles("dist/editor");
  for (const file of editorHtml) {
    assert.doesNotMatch(
      await readFile(file, "utf8"),
      /href="\/editor\/about\/create\/?"/,
      file,
    );
  }
});
