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
const workLanguageControl = (html: string) =>
  html.match(/<nav class="works-detail-language"[^>]*>(.*?)<\/nav>/s)?.[1] ??
  "";

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

test("available About counterparts render exact canonical links", async () => {
  const ja = languageControl(await output("about/index.html"));
  const en = languageControl(await output("en/about/index.html"));
  assert.match(ja, /href="\/en\/about\/"/);
  assert.match(en, /href="\/about\/"/);
  assert.match(ja, /aria-current="true">JA/);
  assert.match(en, /aria-current="true">EN/);
});

test("available Journal counterparts render exact canonical links", async () => {
  const ja = languageControl(await output("journal/index.html"));
  const en = languageControl(await output("en/journal/index.html"));
  assert.match(ja, /href="\/en\/journal\/"/);
  assert.match(en, /href="\/journal\/"/);
  assert.match(ja, /aria-current="true">JA/);
  assert.match(en, /aria-current="true">EN/);
});

test("available Privacy counterparts render exact canonical links", async () => {
  const jaHtml = await output("privacy/index.html");
  const enHtml = await output("en/privacy/index.html");
  const ja = languageControl(jaHtml);
  const en = languageControl(enHtml);

  assert.match(ja, /href="\/en\/privacy\/"/);
  assert.match(en, /href="\/privacy\/"/);
  assert.match(ja, /aria-current="true">JA/);
  assert.match(en, /aria-current="true">EN/);
  assert.match(jaHtml, /<html lang="ja">/);
  assert.match(enHtml, /<html lang="en">/);
  assert.match(
    jaHtml,
    /rel="canonical" href="https:\/\/your-domain\.com\/privacy\/"/,
  );
  assert.match(
    enHtml,
    /rel="canonical" href="https:\/\/your-domain\.com\/en\/privacy\/"/,
  );
});

test("Footer links to the canonical Privacy route for each locale", async () => {
  const ja = await output("privacy/index.html");
  const en = await output("en/privacy/index.html");
  assert.match(ja, /<a href="\/privacy\/">Privacy Policy<\/a>/);
  assert.match(en, /<a href="\/en\/privacy\/">Privacy Policy<\/a>/);
});

test("available detail counterparts render exact canonical links", async () => {
  const artist = languageControl(
    await output("artists/alana-wilson/index.html"),
  );
  const journal = languageControl(
    await output("journal/essay-keisuke-matsuda/index.html"),
  );
  assert.match(artist, /href="\/en\/artists\/alana-wilson\/"/);
  assert.match(journal, /href="\/en\/journal\/essay-keisuke-matsuda\/"/);
});

test("Work details render exact capable counterparts and localized Artist links", async () => {
  for (const contentId of [
    "reiko-kinoshita-01",
    "reiko-kinoshita-02",
    "reiko-kinoshita-03",
    "reiko-kinoshita-04",
    "reiko-kinoshita-05",
    "reiko-kinoshita-06",
    "yuka-mori-01",
  ]) {
    const ja = workLanguageControl(
      await output(`works/${contentId}/index.html`),
    );
    const en = workLanguageControl(
      await output(`en/works/${contentId}/index.html`),
    );
    assert.match(ja, new RegExp(`href="/en/works/${contentId}/"`));
    assert.match(en, new RegExp(`href="/works/${contentId}/"`));
    assert.match(ja, /aria-current="true">JA/);
    assert.match(en, /aria-current="true">EN/);
    assert.equal((ja.match(/<a /g) ?? []).length, 1);
    assert.equal((en.match(/<a /g) ?? []).length, 1);
  }

  const jaHtml = await output("works/yuka-mori-01/index.html");
  const enHtml = await output("en/works/yuka-mori-01/index.html");
  assert.match(jaHtml, /href="\/artists\/yuka-mori\/"/);
  assert.match(enHtml, /href="\/en\/artists\/yuka-mori\/"/);
});

test("unavailable counterparts retain current locale without anchor or separator", async () => {
  for (const path of ["404.html"]) {
    const control = languageControl(await output(path));
    assert.match(control, /aria-current="true">JA/);
    assert.doesNotMatch(control, /<a /);
    assert.doesNotMatch(control, /site-header__language-separator/);
  }
});

test("capable Home counterparts render exact canonical links", async () => {
  const ja = languageControl(await output("index.html"));
  const en = languageControl(await output("en/index.html"));
  assert.match(ja, /href="\/en\/"/);
  assert.match(en, /href="\/"/);
});

test("EN navigation and Footer include implemented families", async () => {
  const html = await output("en/artists/index.html");
  const nav = globalNavigation(html);
  for (const href of [
    "/en/artists/",
    "/en/exhibitions/",
    "/en/journal/",
    "/en/news/",
    "/en/about/",
  ]) {
    assert.match(nav, new RegExp(`href="${href}"`));
  }
  assert.match(html, /href="\/en\/privacy\/"/);
  assert.match(html, /<a href="\/en\/" class="site-header__logo"/);
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
