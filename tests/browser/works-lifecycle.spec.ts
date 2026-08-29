import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const id = "browser-works-lifecycle";
const renamed = "browser-works-lifecycle-renamed";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function openStableWorkspace(
  page: Page,
  contentId: string,
  expectedTitle: string,
) {
  await expect
    .poll(async () => {
      try {
        const response = await page.goto(
          `/editor/works/workspace/${contentId}/`,
          { waitUntil: "networkidle" },
        );
        if (!response?.ok()) return undefined;
        return await page.locator('input[name="title"]').inputValue();
      } catch {
        return undefined;
      }
    })
    .toBe(expectedTitle);
}

test("Works three-file lifecycle acceptance", async ({ page, context }) => {
  test.setTimeout(300_000);
  await page.goto("/editor/works/create/");
  await expect(page.locator("[data-create-save]")).toBeDisabled();
  await page.locator('input[name="contentId"]').fill(id);
  await page.locator('input[name="artist"]').fill("yuka-mori");
  await page.locator('input[name="images.0.src"]').fill("/images/works/yuka-mori-01.png");
  await page.locator('textarea[name="images.0.alt"]').fill("Lifecycle JA alt");
  await page.locator('input[name="title"]').fill("Lifecycle Work");
  await page.locator('input[name="material"]').fill("Paper");
  await page.locator('input[name="size"]').fill("H1 × W1 mm");
  await page.locator('textarea[name="body"]').fill("Lifecycle body");
  await expect(page.locator("[data-create-save]")).toBeEnabled();

  const createPreviewPromise = context.waitForEvent("page");
  await page.locator("[data-create-preview]").click();
  const createPreview = await createPreviewPromise;
  await expect(createPreview.getByRole("heading", { name: "Lifecycle Work" })).toBeVisible();
  await createPreview.close();

  await page.locator("[data-create-save]").click();
  await page.waitForURL(`**/editor/works/workspace/${id}/`);
  const unit = path.join(repository, "src/content/works", id);
  expect((await fs.readdir(unit)).sort()).toEqual(["en.md", "index.yaml", "ja.md"]);
  expect(await fs.readFile(path.join(unit, "en.md"), "utf8")).toContain("__TODO_WORK_TITLE__");
  await expect
    .poll(async () => {
      const response = await page.request.get(`/works/${id}/`, {
        headers: { "cache-control": "no-cache" },
      });
      return {
        containsCreatedTitle: (await response.text()).includes(
          "Lifecycle Work",
        ),
        status: response.status(),
      };
    })
    .toEqual({ containsCreatedTitle: true, status: 200 });
  await openStableWorkspace(page, id, "Lifecycle Work");
  await expect(page.locator("[data-publish-works]")).toBeEnabled();
  const createPublish = page.waitForResponse(
    (response) =>
      response.url().includes(`/editor/api/works-publish/${id}`) &&
      response.request().method() === "POST",
  );
  await page.locator("[data-publish-works]").click();
  const createPublishResponse = await createPublish;
  expect(createPublishResponse.ok()).toBe(true);
  expect((await createPublishResponse.json()).state).toBe("published");
  await expect(page.locator("[data-works-action-status]")).toContainText(
    "Published",
  );

  await page.locator('input[name="title"]').fill("Lifecycle Work Edited");
  await expect(page.locator("[data-save-works]")).toBeEnabled();
  const editPreviewPromise = context.waitForEvent("page");
  await page.locator("[data-preview-works]").click();
  const editPreview = await editPreviewPromise;
  await expect(editPreview.getByRole("heading", { name: "Lifecycle Work Edited" })).toBeVisible();
  await editPreview.close();
  await page.locator("[data-save-works]").click();
  await expect(page.locator("[data-works-action-status]")).toContainText("Saved");
  await expect
    .poll(async () => {
      const response = await page.request.get(`/works/${id}/`, {
        headers: { "cache-control": "no-cache" },
      });
      return {
        containsEditedTitle: (await response.text()).includes(
          "Lifecycle Work Edited",
        ),
        status: response.status(),
      };
    })
    .toEqual({ containsEditedTitle: true, status: 200 });
  await openStableWorkspace(page, id, "Lifecycle Work Edited");
  const editPublish = page.waitForResponse((response) =>
    response.url().includes(`/editor/api/works-publish/${id}`) &&
    response.request().method() === "POST",
  );
  await page.locator("[data-publish-works]").click();
  expect((await editPublish).ok()).toBe(true);

  const upload = path.join(os.tmpdir(), `${id}.png`);
  await fs.writeFile(upload, png);
  const chooser = page.waitForEvent("filechooser");
  await page.locator("[data-asset-replace]").first().click();
  await (await chooser).setFiles(upload);
  await expect(page.locator("[data-works-asset-status]")).toContainText("replacement is temporary");
  const replacementPreviewPromise = context.waitForEvent("page");
  await page.locator("[data-preview-works]").click();
  const replacementPreview = await replacementPreviewPromise;
  await expect(replacementPreview.getByRole("heading", { name: "Lifecycle Work Edited" })).toBeVisible();
  await replacementPreview.close();
  await page.getByRole("button", { name: "Cancel replacement" }).click();
  await expect(page.locator("[data-works-asset-status]")).toContainText("reference restored");
  expect(await fs.readFile(path.join(unit, "index.yaml"), "utf8")).toContain("/images/works/yuka-mori-01.png");

  // Canonical content commits trigger Astro's content watcher. Reload at this
  // explicit boundary so a delayed HMR navigation cannot interrupt Rename.
  await openStableWorkspace(page, id, "Lifecycle Work Edited");
  await expect(page.getByRole("heading", { name: "Lifecycle Work Edited" })).toBeVisible();

  const renameDestination = page.locator("[data-rename-destination]");
  await renameDestination.fill(renamed);
  await expect(renameDestination).toHaveValue(renamed);
  await expect(page.locator("[data-rename-plan]")).toBeEnabled();
  const renamePlanResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.request().postDataJSON()?.action === "plan" &&
    response.request().postDataJSON()?.sourceContentId === id,
  );
  await page.locator("[data-rename-plan]").click();
  const renamePlanHttp = await renamePlanResponse;
  expect(renamePlanHttp.ok()).toBe(true);
  await expect(page.locator("[data-rename-review]")).toBeVisible();
  await page.locator("[data-rename-confirm]").check();
  await page.locator("[data-rename-execute]").click();
  await page.waitForURL(`**/editor/works/workspace/${renamed}/`);
  const renamedUnit = path.join(repository, "src/content/works", renamed);
  await expect.poll(async () => fs.access(unit).then(() => false, () => true)).toBe(true);
  expect((await fs.readdir(renamedUnit)).sort()).toEqual(["en.md", "index.yaml", "ja.md"]);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/works/${renamed}/`, {
        headers: { "cache-control": "no-cache" },
      });
      return {
        containsRenamedTitle: (await response.text()).includes(
          "Lifecycle Work Edited",
        ),
        status: response.status(),
      };
    })
    .toEqual({ containsRenamedTitle: true, status: 200 });
  await openStableWorkspace(page, renamed, "Lifecycle Work Edited");
  await expect(
    page.getByRole("heading", { name: "Lifecycle Work Edited" }),
  ).toBeVisible();
  const renamePublish = page.waitForResponse((response) =>
    response.url().includes(`/editor/api/works-publish/${renamed}`) &&
    response.request().method() === "POST",
  );
  await page.locator("[data-publish-works]").click();
  expect((await renamePublish).ok()).toBe(true);

  await expect(page.locator("[data-delete-status]")).toContainText("Choose the exact pre-delete backup");
  await expect(page.locator("[data-delete-plan]")).toBeDisabled();
});
