import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("About singleton previews, saves, and publishes JA while pending Shared and placeholder EN stay explicit", async ({ page, context }) => {
  const unit = path.join(repository, "src/content/about/about");
  const assets = ["about-hero.jpg", "about-01.jpg", "about-02.jpg", "about-03.jpg", "about-04.jpg"];
  const before = Object.fromEntries(await Promise.all(assets.map(async name => [name, hash(await readFile(path.join(repository, "public/images/about", name)))])));
  await page.goto("/editor/about/workspace/about/");
  await expect(page.locator("[data-about-hours]")).toHaveText("pending");
  await expect(page.locator("[data-about-ja-status]")).toHaveText("review");
  await expect(page.locator("[data-about-en-status]")).toHaveText("placeholder");
  await expect(page.getByRole("button", { name: "Preview JA" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Preview EN" })).toBeDisabled();
  await page.getByLabel("Statement · Markdown").first().fill("KiKi Gallery ブラウザー確認用レビュー文。");
  const popupPromise = context.waitForEvent("page"); await page.getByRole("button", { name: "Preview JA" }).click(); const popup = await popupPromise; await popup.waitForLoadState();
  await expect(popup.getByText("KiKi Gallery ブラウザー確認用レビュー文。")).toBeVisible(); await expect(popup.locator("[data-hours-pending]")).toBeVisible(); await popup.close();
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/editor/api/about")); await page.getByRole("button", { name: "Save" }).click(); expect((await responsePromise).ok()).toBe(true); await expect(page.locator("[data-about-action-status]")).toContainText("Saved");
  await page.getByRole("button", { name: "Publish" }).click(); await expect(page.locator("[data-about-action-status]")).toContainText("Published");
  expect((await readdir(unit)).sort()).toEqual(["en.md", "index.yaml", "ja.md"]);
  for (const name of assets) expect(hash(await readFile(path.join(repository, "public/images/about", name)))).toBe(before[name]);
  expect(await readFile(path.join(repository, "src/pages/about.astro"), "utf8")).toContain("getAboutProductionFacade");
});
