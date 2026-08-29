import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

test("About JA/EN Preview responses are no-store without changing public or other Preview cache behavior", async ({
  page,
  request,
}) => {
  await page.goto("/editor/about/workspace/about/");
  const previews = await page.evaluate(async () => {
    const draft = JSON.parse(
      document.querySelector("#about-editor-draft")!.textContent!,
    );
    draft.locales.ja.value.body = "JA no-store preview contract";
    draft.locales.en.value.body = "EN no-store preview contract";
    const previews = [];
    for (const locale of ["ja", "en"] as const) {
      const created = await fetch("/editor/api/about-preview/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft, locale }),
      });
      previews.push({
        locale,
        status: created.status,
        ...(await created.json()),
      });
    }
    return previews;
  });

  for (const preview of previews) {
    expect(preview.status).toBe(200);
    const response = await request.get(preview.url);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.text()).toContain(
      `${preview.locale.toUpperCase()} no-store preview contract`,
    );
  }

  for (const path of ["/about/", "/en/about/"]) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"] ?? "").not.toContain("no-store");
  }

  const unrelatedPreview = await request.get(
    "/editor/preview/news/invalid-token/invalid-content",
  );
  expect(unrelatedPreview.status()).toBe(404);
  expect(unrelatedPreview.headers()["cache-control"]).toBeUndefined();
});

test("About singleton selects validated media, pairs locale alts, previews, saves, and publishes", async ({
  page,
  context,
}) => {
  const unit = path.join(repository, "src/content/about/about");
  const assets = [
    "about-hero.jpg",
    "about-01.jpg",
    "about-02.jpg",
    "about-03.jpg",
    "about-04.jpg",
  ];
  const before = Object.fromEntries(
    await Promise.all(
      assets.map(async (name) => [
        name,
        hash(
          await readFile(path.join(repository, "public/images/about", name)),
        ),
      ]),
    ),
  );

  await page.goto("/editor/about/workspace/about/");
  await expect(page.locator("[data-about-hours]")).toHaveText("approved");
  await expect(page.locator("[data-about-ja-status]")).toHaveText("approved");
  await expect(page.locator("[data-about-en-status]")).toHaveText("approved");
  await expect(page.getByRole("button", { name: "Preview JA" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Preview EN" })).toBeEnabled();

  const hero = page.locator('[data-about-image-slot="hero"]');
  await expect(hero.locator("select")).toHaveValue(
    "/images/about/about-hero.jpg",
  );
  await expect(hero.locator("img")).toHaveAttribute(
    "src",
    "/images/about/about-hero.jpg",
  );
  await expect(hero.locator("option")).toHaveCount(5);
  const gallery = page.locator('[data-about-image-slot^="gallery-"]');
  await expect(gallery).toHaveCount(4);
  await expect(gallery.first().getByLabel("JA alt")).toBeVisible();
  await expect(gallery.first().getByLabel("EN alt")).toBeVisible();

  const invalidAssetResponses = await page.evaluate(async () => {
    const source = document.querySelector("#about-editor-draft")!.textContent!;
    const baseline = JSON.parse(source);
    const draft = structuredClone(baseline);
    draft.shared.value.images.hero.src = "/images/about/missing.jpg";
    const preview = await fetch("/editor/api/about-preview/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft, locale: "ja" }),
    });
    const save = await fetch("/editor/api/about", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft, baseline }),
    });
    return [preview.status, save.status];
  });
  expect(invalidAssetResponses).toEqual([400, 400]);

  await page
    .getByLabel("Statement · Markdown")
    .first()
    .fill("KiKi Gallery ブラウザー確認用レビュー文。");
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "Preview JA" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(
    popup.getByText("KiKi Gallery ブラウザー確認用レビュー文。"),
  ).toBeVisible();
  await expect(popup.getByText("土・日 13:00–18:00")).toBeVisible();
  await popup.close();

  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/editor/api/about"),
  );
  await page.getByRole("button", { name: "Save" }).click();
  expect((await responsePromise).ok()).toBe(true);
  await expect(page.locator("[data-about-action-status]")).toContainText(
    "Saved",
  );
  await page.reload();
  await expect(page.getByLabel("Statement · Markdown").first()).toHaveValue(
    "KiKi Gallery ブラウザー確認用レビュー文。",
  );
  const publishResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/editor/api/about-publish") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish" }).click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.ok()).toBe(true);
  expect((await publishResponse.json()).state).toBe("published");
  await expect(page.locator("[data-about-action-status]")).toContainText(
    "Published",
  );

  expect((await readdir(unit)).sort()).toEqual([
    "en.md",
    "index.yaml",
    "ja.md",
  ]);
  for (const name of assets)
    expect(
      hash(await readFile(path.join(repository, "public/images/about", name))),
    ).toBe(before[name]);
  expect(
    await readFile(path.join(repository, "src/pages/about.astro"), "utf8"),
  ).toContain("getAboutProductionFacade");
  const shared = await readFile(path.join(unit, "index.yaml"), "utf8");
  const ja = await readFile(path.join(unit, "ja.md"), "utf8");
  const en = await readFile(path.join(unit, "en.md"), "utf8");
  expect(shared).toContain("src: /images/about/about-01.jpg");
  expect(shared).not.toContain("alt:");
  expect(ja).toContain("alt:");
  expect(en).toContain("alt:");
  expect(ja).not.toContain("src:");
  expect(en).not.toContain("src:");
});
