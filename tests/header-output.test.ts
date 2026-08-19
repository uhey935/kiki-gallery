import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const output = (path: string) => readFile(`dist/${path}`, "utf8");
const headerSource = () => readFile("src/components/Header.astro", "utf8");
const languageControl = (html: string) =>
  html.match(/<div class="site-header__language"[^>]*>(.*?)<\/div>/s)?.[1] ??
  "";
const globalNavigation = (html: string) =>
  html.match(/<nav class="site-header__nav"[^>]*>(.*?)<\/nav>/s)?.[1] ?? "";

test("available index counterparts render exact canonical links", async () => {
  const ja = languageControl(await output("artists/index.html"));
  const en = languageControl(await output("en/artists/index.html"));
  assert.match(ja, /href="\/en\/artists\/"/);
  assert.match(en, /href="\/artists\/"/);
  assert.match(ja, /aria-current="true">JA/);
  assert.match(en, /aria-current="true">EN/);
  assert.match(ja, /site-header__language-separator/);
  assert.match(en, /site-header__language-separator/);
});

test("unavailable counterparts retain current locale without anchor or separator", async () => {
  for (const path of [
    "index.html",
    "about/index.html",
    "journal/index.html",
    "artists/alana-wilson/index.html",
    "404.html",
  ]) {
    const control = languageControl(await output(path));
    assert.match(control, /aria-current="true">JA/);
    assert.doesNotMatch(control, /<a /);
    assert.doesNotMatch(control, /site-header__language-separator/);
  }
});

test("EN navigation includes implemented families and omits dead EN routes", async () => {
  const html = await output("en/artists/index.html");
  const nav = globalNavigation(html);
  for (const href of ["/en/artists/", "/en/exhibitions/", "/en/news/"]) {
    assert.match(nav, new RegExp(`href="${href}"`));
  }
  for (const href of ["/en/", "/en/about/", "/en/journal/", "/en/privacy/"]) {
    assert.doesNotMatch(html, new RegExp(`href="${href}"`));
  }
  assert.match(html, /<a href="\/" class="site-header__logo"/);
});

test("menu navigation waits for the actual overlay close transition with a fallback", async () => {
  const source = await headerSource();

  assert.match(source, /overlay\.addEventListener\("transitionend"/);
  assert.match(source, /event\.propertyName === "transform"/);
  assert.match(source, /window\.getComputedStyle\(overlay\)/);
  assert.match(
    source,
    /window\.setTimeout\(finishClose, transitionTime \+ 100\)/,
  );
  assert.match(source, /window\.location\.assign\(destination\.href\)/);
});

test("menu navigation interception preserves native non-standard clicks and links", async () => {
  const source = await headerSource();

  for (const nativeBehaviorGuard of [
    "event.button !== 0",
    "event.metaKey",
    "event.ctrlKey",
    "event.shiftKey",
    "event.altKey",
    'link.target.toLowerCase() === "_blank"',
    'link.hasAttribute("download")',
    "destination.origin === window.location.origin",
    "isSameDocument",
  ]) {
    assert.ok(source.includes(nativeBehaviorGuard), nativeBehaviorGuard);
  }

  assert.match(
    source,
    /if \(pendingNavigation\) \{\s*event\.preventDefault\(\)/,
  );
});
