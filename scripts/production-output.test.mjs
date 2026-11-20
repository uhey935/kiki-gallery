import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { stripEditor } from "./production-output.mjs";

async function fixture(t, extra = {}) {
  const temp = await mkdtemp(path.join(tmpdir(), "kiki-output-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "dist");
  const pub = path.join(temp, "public");
  await mkdir(pub);
  const files = {
    "index.html":
      '<link href="/_astro/site.hash.css"><astro-island component-url="/_astro/island.hash.js">',
    "editor/index.html": '<script src="/_astro/editor.hash.js"></script>',
    "_astro/site.hash.css": 'body{background:url("./image.hash.webp")}',
    "_astro/image.hash.webp": "image",
    "_astro/island.hash.js":
      'import "./shared.hash.js"; const preload=["_astro/lazy.hash.js"];',
    "_astro/lazy.hash.js": "export default 1",
    "_astro/shared.hash.js": "export const n=1",
    "_astro/editor.hash.js":
      'import "./shared.hash.js"; import("./draft.hash.js")',
    "_astro/draft.hash.js": 'fetch("/editor/api/home")',
    ...extra,
  };
  for (const [name, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), source);
  }
  return {
    root,
    pub,
    run: () => stripEditor(root, pub),
  };
}

test("keeps public transitive CSS, islands, preload and shared dependencies; removes Editor closure", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.run(), {
    editorPagesRemoved: 1,
    assetsRemoved: 2,
    publicPages: 1,
    assetsRetained: 5,
    publicFilesRetained: 0,
  });
  assert.equal((await readdir(f.root)).includes("editor"), false);
  assert.equal(
    await readFile(path.join(f.root, "_astro/shared.hash.js"), "utf8"),
    "export const n=1",
  );
});
for (const [label, extra, error] of [
  [
    "unknown asset",
    { "_astro/orphan.hash.js": "secret" },
    /Unclassified Astro/,
  ],
  [
    "alternate data URL",
    { "data/draft.json": '{"secret":1}' },
    /Unclassified output/,
  ],
  [
    "Editor code shared with public",
    { "_astro/shared.hash.js": 'fetch("/editor/api/home")' },
    /Editor content/,
  ],
  [
    "missing generated dependency",
    {
      "_astro/island.hash.js":
        'import("/_astro/missing.js");import("./lazy.hash.js")',
    },
    /Missing Astro reference/,
  ],
  [
    "missing relative dependency",
    {
      "_astro/island.hash.js":
        'import("./missing.js");import("./lazy.hash.js")',
    },
    /Missing Astro reference/,
  ],
]) {
  test(`fails before deleting anything: ${label}`, async (t) => {
    const f = await fixture(t, extra);
    await assert.rejects(f.run(), error);
    assert.match(
      await readFile(path.join(f.root, "editor/index.html"), "utf8"),
      /script/,
    );
  });
}
test("public static code under an unrelated URL is rejected", async (t) => {
  const f = await fixture(t, { "hidden.js": "secret" });
  await writeFile(path.join(f.pub, "hidden.js"), "secret");
  await assert.rejects(f.run(), /Unaudited public file/);
});
test("ordinary public images and favicon are preserved byte for byte", async (t) => {
  const f = await fixture(t, { "favicon.svg": "<svg></svg>" });
  await writeFile(path.join(f.pub, "favicon.svg"), "<svg></svg>");
  assert.equal((await f.run()).publicFilesRetained, 1);
});

for (const count of [0, 1, 3]) {
  test(`retains every public HTML byte with ${count} additional pages`, async (t) => {
    const extra = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `works/new-${i}/index.html`,
        `<p>Work ${i}</p>`,
      ]),
    );
    const f = await fixture(t, extra);
    assert.equal((await f.run()).publicPages, count + 1);
    for (const [name, value] of Object.entries(extra))
      assert.equal(await readFile(path.join(f.root, name), "utf8"), value);
  });
}
for (const [name, value] of [
  [
    "robots.txt",
    "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n",
  ],
  [
    "sitemap.xml",
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>',
  ],
  ["fonts/site.woff2", "font-fixture"],
]) {
  test(`preserves classified static file ${name}`, async (t) => {
    const f = await fixture(t, { [name]: value });
    await mkdir(path.dirname(path.join(f.pub, name)), { recursive: true });
    await writeFile(path.join(f.pub, name), value);
    assert.equal((await f.run()).publicFilesRetained, 1);
    assert.equal(await readFile(path.join(f.root, name), "utf8"), value);
  });
}
for (const [name, value] of [
  ["data.json", '{"draft":true}'],
  ["robots.txt", "User-agent: *\nDisallow: /editor/"],
  ["robots.txt", '{"privateDraft":true}'],
  [
    "sitemap.xml",
    "<urlset><url><loc>https://example.com/editor/</loc></url></urlset>",
  ],
  ["sitemap.xml", "<html>not a sitemap</html>"],
  ["images/draft/secret.svg", "<svg/>"],
]) {
  test(`rejects unclassified or Editor content in ${name}`, async (t) => {
    const f = await fixture(t, { [name]: value });
    await mkdir(path.dirname(path.join(f.pub, name)), { recursive: true });
    await writeFile(path.join(f.pub, name), value);
    await assert.rejects(f.run(), /Unaudited|Editor content|Invalid/);
    await readFile(path.join(f.root, "editor/index.html"));
  });
}
for (const name of ["_worker.js", "functions/api.js", "server/entry.mjs"]) {
  test(`rejects unexpected server output ${name}`, async (t) => {
    const f = await fixture(t, { [name]: "server" });
    await assert.rejects(f.run(), /Unclassified output/);
  });
}
