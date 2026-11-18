import assert from "node:assert/strict";
import test from "node:test";
import { homeSchema } from "./home.ts";
import { newsSchema } from "./news.ts";
import { editorWorkSchema } from "./work.ts";

const home = (href: string) =>
  homeSchema.safeParse({
    sections: [
      { id: "artists", title: "Artists", href, image: { src: "/a.jpg" } },
      {
        id: "about",
        title: "About",
        href: "/about",
        image: { src: "/b.jpg" },
      },
    ],
  });

const news = (link: string) =>
  newsSchema.safeParse({
    date: "2026-01-01",
    news_type: "general",
    title: "News",
    link,
    show_on_home: false,
  });

const work = (url: string) =>
  editorWorkSchema.safeParse({
    artist: "artist",
    images: [{ src: "/a.jpg", alt: "A" }],
    inquiry: { type: "shop", url },
    title: "Work",
  });

const cases = [
  {
    name: "HTTP URL",
    value: "http://example.com/path",
    home: true,
    news: true,
    work: true,
  },
  {
    name: "HTTPS URL",
    value: "https://example.com/path?q=1#part",
    home: true,
    news: true,
    work: true,
  },
  {
    name: "FTP URL",
    value: "ftp://example.com/file",
    home: false,
    news: false,
    work: true,
  },
  {
    name: "mailto URL",
    value: "mailto:user@example.com",
    home: false,
    news: false,
    work: true,
  },
  {
    name: "javascript URL",
    value: "javascript:alert(1)",
    home: false,
    news: false,
    work: true,
  },
  {
    name: "data URL",
    value: "data:text/plain,hello",
    home: false,
    news: false,
    work: true,
  },
  {
    name: "uppercase scheme",
    value: "HTTPS://example.com",
    home: false,
    news: false,
    work: true,
  },
  {
    name: "root-relative path",
    value: "/internal",
    home: true,
    news: true,
    work: true,
  },
  {
    name: "protocol-relative path",
    value: "//host/path",
    home: true,
    news: true,
    work: true,
  },
  {
    name: "relative URL",
    value: "relative/path",
    home: false,
    news: false,
    work: false,
  },
  { name: "empty string", value: "", home: false, news: false, work: false },
  {
    name: "malformed URL",
    value: "https://",
    home: false,
    news: false,
    work: false,
  },
] as const;

test("Home, News, and Works preserve their URL acceptance contracts", async (t) => {
  for (const item of cases) {
    await t.test(item.name, () => {
      assert.equal(home(item.value).success, item.home, `Home: ${item.value}`);
      assert.equal(news(item.value).success, item.news, `News: ${item.value}`);
      assert.equal(work(item.value).success, item.work, `Works: ${item.value}`);
    });
  }
});

test("Home and News preserve the URL refinement issue", () => {
  const expected = (path: (string | number)[]) => [
    {
      code: "invalid_union",
      errors: [
        [
          {
            code: "custom",
            path: [],
            message: "Must use an http:// or https:// URL.",
          },
        ],
        [
          {
            origin: "string",
            code: "invalid_format",
            format: "starts_with",
            prefix: "/",
            path: [],
            message: 'Invalid string: must start with "/"',
          },
        ],
      ],
      path,
      message: "Invalid input",
    },
  ];

  const homeResult = home("ftp://example.com");
  assert.equal(homeResult.success, false);
  if (!homeResult.success)
    assert.deepEqual(
      homeResult.error.issues,
      expected(["sections", 0, "href"]),
    );

  const newsResult = news("ftp://example.com");
  assert.equal(newsResult.success, false);
  if (!newsResult.success)
    assert.deepEqual(newsResult.error.issues, expected(["link"]));
});

test("Works preserves its URL union issue code, message, and field path", () => {
  const result = work("relative/path");
  assert.equal(result.success, false);
  if (!result.success)
    assert.deepEqual(result.error.issues, [
      {
        code: "invalid_union",
        errors: [
          [
            {
              code: "invalid_format",
              format: "url",
              path: [],
              message: "Invalid URL",
            },
          ],
          [
            {
              origin: "string",
              code: "invalid_format",
              format: "starts_with",
              prefix: "/",
              path: [],
              message: 'Invalid string: must start with "/"',
            },
          ],
        ],
        path: ["inquiry", "url"],
        message: "Invalid input",
      },
    ]);
});
