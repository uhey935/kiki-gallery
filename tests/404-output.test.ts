import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { parsePublicRouteIdentity } from "../src/content-boundaries/locale-routes.ts";

const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

test("build emits one locale-neutral infrastructure 404", async () => {
  assert.equal(await exists("dist/404.html"), true);
  assert.equal(await exists("dist/en/404.html"), false);
  assert.equal(await exists("dist/en/404/index.html"), false);

  const html = await readFile("dist/404.html", "utf8");
  assert.match(html, /<html lang="und">/);
  assert.match(html, /<title>404 \| KiKi Gallery<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.doesNotMatch(html, /<link rel="canonical"/);
  assert.doesNotMatch(html, /<meta property="og:/);
  assert.doesNotMatch(html, /rel="alternate"|hreflang=/);
  assert.match(html, /The requested page could not be found\./);
  assert.match(html, /お探しのページが見つかりませんでした。/);
  assert.match(
    html,
    /<a href="\/" class="action-link" lang="ja">日本語 Home<\/a>/,
  );
  assert.match(
    html,
    /<a href="\/en\/" class="action-link" lang="en">English Home<\/a>/,
  );
  assert.doesNotMatch(html, /href="\/en\/404\/?"/);
  assert.doesNotMatch(html, /class="site-header"|class="footer"/);
});

test("404 remains outside public locale route projection", () => {
  assert.equal(parsePublicRouteIdentity("/404/"), undefined);
  assert.equal(parsePublicRouteIdentity("/en/404/"), undefined);
});

test("normal pages retain shared canonical, social, and chrome defaults", async () => {
  const html = await readFile("dist/index.html", "utf8");
  assert.match(html, /<link rel="canonical"/);
  assert.match(html, /<meta property="og:url"/);
  assert.match(html, /class="site-header/);
  assert.match(html, /class="footer"/);
});
