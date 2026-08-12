import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("Home three-file workspace previews, saves, and publishes JA while EN stays blocked", async ({ page, context }) => {
  const unit = path.join(repository, "src/content/home/home");
  const assets = ["artists-square.jpg", "about-landscape.jpg", "fallback-hero.webp"];
  const assetBefore = Object.fromEntries(
    await Promise.all(assets.map(async (name) => [name, hash(await readFile(path.join(repository, "public/images/home", name)))])),
  );
  await page.goto("/editor/home/workspace/home/");
  await expect(page.getByText("Temporary / requires final copy")).toBeVisible();
  await expect(page.getByText("Unresolved translation / Preview blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview JA" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Preview EN" })).toBeDisabled();

  await page.getByLabel("About intro · Required").first().fill("Browser JA fixture copy");
  const previewPagePromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "Preview JA" }).click();
  const previewPage = await previewPagePromise;
  await previewPage.waitForLoadState();
  await expect(previewPage.getByText("Browser JA fixture copy")).toBeVisible();
  await expect(previewPage.getByRole("heading", { name: "Exhibitions" })).toBeVisible();
  await expect(previewPage.getByRole("heading", { name: "Stories" })).toBeVisible();
  await previewPage.close();

  const saveResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/editor/api/home"),
  );
  await page.getByRole("button", { name: "Save" }).click();
  const saveResponse = await saveResponsePromise;
  expect(
    saveResponse.ok(),
    `Save failed (${saveResponse.status()}): ${await saveResponse.text()}`,
  ).toBe(true);
  await expect(page.getByText("Saved · ready")).toBeVisible();
  await expect.poll(async () => (await readFile(path.join(unit, "ja.md"), "utf8")).includes("Browser JA fixture copy")).toBe(true);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.locator("[data-home-action-status]")).toContainText("Published");

  expect((await readdir(unit)).sort()).toEqual(["en.md", "index.yaml", "ja.md"]);
  await expect.poll(async () => readFile(path.join(repository, "src/content/home/home.md")).then(() => true).catch(() => false)).toBe(false);
  for (const name of assets)
    expect(hash(await readFile(path.join(repository, "public/images/home", name)))).toBe(assetBefore[name]);
});
