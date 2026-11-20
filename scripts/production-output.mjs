import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const textFile = /\.(?:html|css|js|mjs|json|svg|txt|xml|map)$/i;
const privateContent =
  /(?:\/editor(?:\/|["'`?#\s<])|\.kiki-editor|data-editor-|editor-workspace)/i;
const editorFile = (name) =>
  name === "editor.html" || name.startsWith("editor/");

async function inventory(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${name}`);
    if (entry.isDirectory()) files.push(...(await inventory(root, name + "/")));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unexpected output entry: ${name}`);
  }
  return files.sort();
}

// Match complete emitted filenames, not fixed hashes or only HTML src/href.
// This deliberately over-approximates references: relative imports, CSS url(),
// Astro island attributes/serialized props and Vite's bare preload filenames
// all retain their targets. Ambiguous/unclassified assets fail closed below.
export function references(source, target) {
  const name = path.posix.basename(target);
  const normalized = source.replace(/\\u002[fF]|\\x2[fF]|\\\//g, "/");
  return [name, encodeURI(name), encodeURIComponent(name)].some((value) =>
    normalized.includes(value),
  );
}

export async function stripEditor(root, publicRoot) {
  const files = await inventory(root);
  const statics = await inventory(publicRoot);
  const staticSet = new Set(statics);
  const buffers = new Map(
    await Promise.all(
      files.map(async (name) => [name, await readFile(path.join(root, name))]),
    ),
  );
  const texts = new Map(
    [...buffers]
      .filter(([name]) => textFile.test(name))
      .map(([name, bytes]) => [name, bytes.toString("utf8")]),
  );
  const pages = files.filter(
    (name) => name.endsWith(".html") && !editorFile(name),
  );
  const editor = files.filter(editorFile);
  const assets = files.filter((name) => name.startsWith("_astro/"));
  if (!editor.some((name) => name.endsWith(".html")))
    throw new Error("Missing Editor HTML: run a fresh Astro build first");

  // public/ bypasses the generated module graph. Classify by purpose, not
  // merely by presence in that directory. New code/data types require review.
  for (const name of statics) {
    const media =
      /^(?:images\/.+\.(?:png|jpe?g|webp|gif|avif|svg)|favicon\.(?:ico|svg)|fonts\/.+\.(?:woff2?|ttf|otf))$/i.test(
        name,
      );
    const discovery = /^(?:robots\.txt|sitemap(?:-[a-z0-9-]+)?\.xml)$/.test(
      name,
    );
    if (
      (!media && !discovery) ||
      /(?:^|\/)(?:\.[^/]+|editor|drafts?|preview)(?:\/|\.|$)/i.test(name)
    )
      throw new Error(`Unaudited public file: ${name}`);
    if (discovery) {
      const source = buffers.get(name)?.toString("utf8") ?? "";
      if (name === "robots.txt") {
        if (
          source
            .split(/\r?\n/)
            .some(
              (line) =>
                line.trim() &&
                !/^\s*(?:#|(?:User-agent|Allow|Disallow|Sitemap|Crawl-delay|Host)\s*:)/i.test(
                  line,
                ),
            )
        )
          throw new Error(`Invalid robots directives: ${name}`);
      } else if (
        !/<(?:urlset|sitemapindex)\b/.test(source) ||
        /<\s*(?:script|html)\b|<!ENTITY/i.test(source)
      ) {
        throw new Error(`Invalid sitemap content: ${name}`);
      }
    }
    if (!buffers.get(name)?.equals(await readFile(path.join(publicRoot, name))))
      throw new Error(`Public copy differs or is missing: ${name}`);
  }
  for (const name of files) {
    if (
      !editorFile(name) &&
      !name.endsWith(".html") &&
      !name.startsWith("_astro/") &&
      !staticSet.has(name)
    )
      throw new Error(`Unclassified output (possible data leak): ${name}`);
  }
  const graph = new Map(
    [...texts].map(([name, source]) => [
      name,
      assets.filter((asset) => references(source, asset)),
    ]),
  );
  function reachable(roots) {
    const seen = new Set(roots);
    for (const name of seen)
      for (const dependency of graph.get(name) ?? []) seen.add(dependency);
    return seen;
  }
  const publicReach = reachable([...pages, ...statics]);
  const editorReach = reachable(editor);
  for (const name of assets) {
    if (!publicReach.has(name) && !editorReach.has(name))
      throw new Error(`Unclassified Astro asset: ${name}`);
  }
  const remove = new Set([
    ...editor,
    ...assets.filter((name) => editorReach.has(name) && !publicReach.has(name)),
  ]);
  for (const [name, source] of texts) {
    if (remove.has(name)) continue;
    if (privateContent.test(source))
      throw new Error(`Editor content in retained output: ${name}`);
    for (const removed of remove) {
      // HTML index.html basenames are ambiguous; check full Editor paths instead.
      if (removed.startsWith("_astro/") && references(source, removed))
        throw new Error(
          `Retained file references removed asset: ${name} -> ${removed}`,
        );
    }
    // Catch missing generated targets as well as references to known files.
    for (const match of source.matchAll(/(?:["'`]|url\(\s*)([^\s"'`<>)]*)/g)) {
      const value = match[1].split(/[?#]/)[0];
      if (!/^(?:\.?\.?\/|_astro\/)/.test(value)) continue;
      const base = name.endsWith("/index.html") ? name.slice(0, -10) : name;
      const target = decodeURIComponent(
        new URL(
          value.startsWith("_astro/") ? "/" + value : value,
          "https://output.invalid/" + base,
        ).pathname,
      ).slice(1);
      if (target.startsWith("_astro/") && !buffers.has(target))
        throw new Error(`Missing Astro reference: ${name} -> ${target}`);
    }
  }
  // All checks above finish before any deletion. Preserve every other byte.
  await rm(path.join(root, "editor"), { recursive: true, force: true });
  for (const name of remove) await rm(path.join(root, name), { force: true });
  const after = await inventory(root);
  const expected = files.filter((name) => !remove.has(name));
  if (JSON.stringify(after) !== JSON.stringify(expected))
    throw new Error("Unexpected final output inventory");
  const publicPagesAfter = after.filter((name) => name.endsWith(".html"));
  if (JSON.stringify(publicPagesAfter) !== JSON.stringify(pages))
    throw new Error("Public HTML inventory changed");
  for (const name of after) {
    if (!(await readFile(path.join(root, name))).equals(buffers.get(name)))
      throw new Error(`Retained output changed: ${name}`);
  }
  const result = {
    editorPagesRemoved: editor.filter((name) => name.endsWith(".html")).length,
    assetsRemoved: assets.filter((name) => remove.has(name)).length,
    publicPages: pages.length,
    assetsRetained: assets.filter((name) => !remove.has(name)).length,
    publicFilesRetained: statics.length,
  };
  console.log("Production output verified:", JSON.stringify(result));
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await stripEditor(path.resolve("dist"), path.resolve("public"));
}
