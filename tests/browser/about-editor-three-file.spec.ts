import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

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
  await page.getByRole("button", { name: "Publish" }).click();
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
