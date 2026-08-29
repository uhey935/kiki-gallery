import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

test("Home three-file workspace previews both locales, saves, and publishes", async ({
  page,
  context,
}) => {
  const unit = path.join(repository, "src/content/home/home");
  const assets = [
    "artists-square.jpg",
    "about-landscape.jpg",
    "fallback-hero.webp",
  ];
  const assetBefore = Object.fromEntries(
    await Promise.all(
      assets.map(async (name) => [
        name,
        hash(await readFile(path.join(repository, "public/images/home", name))),
      ]),
    ),
  );
  await page.goto("/editor/home/workspace/home/");
  await expect(page.getByText("Temporary / requires final copy")).toHaveCount(
    0,
  );
  await expect(page.getByText("Copy approved")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview JA" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Preview EN" })).toBeEnabled();

  await page
    .getByLabel("About intro · Required")
    .first()
    .fill("Browser JA fixture copy");
  const previewPagePromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "Preview JA" }).click();
  const previewPage = await previewPagePromise;
  await previewPage.waitForLoadState();
  await expect(previewPage.getByText("Browser JA fixture copy")).toBeVisible();
  await expect(
    previewPage.getByRole("heading", { name: "Exhibitions" }),
  ).toBeVisible();
  await expect(
    previewPage.getByRole("heading", { name: "Stories" }),
  ).toBeVisible();
  await previewPage.close();

  const enPreviewPagePromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "Preview EN" }).click();
  const enPreviewPage = await enPreviewPagePromise;
  await enPreviewPage.waitForLoadState();
  await expect(
    enPreviewPage.getByText("White Porcelain Chrysanthemum-shaped Dish"),
  ).toBeVisible();
  await enPreviewPage.close();

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
  await expect
    .poll(async () =>
      (await readFile(path.join(unit, "ja.md"), "utf8")).includes(
        "Browser JA fixture copy",
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel("About intro · Required").first()).toHaveValue(
    "Browser JA fixture copy",
  );
  const publishResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/editor/api/home-publish") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish" }).click();
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.ok()).toBe(true);
  expect((await publishResponse.json()).state).toBe("published");
  await expect(page.locator("[data-home-action-status]")).toContainText(
    "Published",
  );
  await expect
    .poll(async () => {
      const response = await page.request.get("/", {
        headers: { "cache-control": "no-cache" },
      });
      return {
        containsPublishedCopy: (await response.text()).includes(
          "Browser JA fixture copy",
        ),
        status: response.status(),
      };
    })
    .toEqual({ containsPublishedCopy: true, status: 200 });

  expect((await readdir(unit)).sort()).toEqual([
    "en.md",
    "index.yaml",
    "ja.md",
  ]);
  await expect
    .poll(async () =>
      readFile(path.join(repository, "src/content/home/home.md"))
        .then(() => true)
        .catch(() => false),
    )
    .toBe(false);
  for (const name of assets)
    expect(
      hash(await readFile(path.join(repository, "public/images/home", name))),
    ).toBe(assetBefore[name]);
});
