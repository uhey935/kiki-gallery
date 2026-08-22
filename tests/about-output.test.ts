import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public About output derives matching JA and EN closed weekdays", async () => {
  const [ja, en] = await Promise.all([
    readFile("dist/about/index.html", "utf8"),
    readFile("dist/en/about/index.html", "utf8"),
  ]);

  assert.match(ja, />営業日</);
  assert.match(ja, />土・日 13:00–18:00</);
  assert.match(ja, />休廊日</);
  assert.match(ja, />月・火・水・木・金</);
  assert.match(en, />Open</);
  assert.match(en, />Sat, Sun 13:00–18:00</);
  assert.match(en, />Closed</);
  assert.match(en, />Mon, Tue, Wed, Thu, Fri</);

  const signature = (html: string) => {
    const about = /<main class="about"[\s\S]*?<\/main>/.exec(html)?.[0] ?? "";
    return [...about.matchAll(/<\/?([a-z][a-z0-9-]*)(?:\s[^>]*)?>/g)].map(
      ([tag, name]) => ({
        closing: tag.startsWith("</"),
        name,
        classes: /class="([^"]+)"/.exec(tag)?.[1] ?? "",
      }),
    );
  };
  assert.deepEqual(signature(ja), signature(en));
});
