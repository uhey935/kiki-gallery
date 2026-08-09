import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const repositoryRoot = process.env.KIKI_BROWSER_REPOSITORY!;
const contentId = "browser-foundation-news";
const renamedId = "browser-foundation-news-renamed";

test("launch, lifecycle smoke flow, and fail-closed gates", async ({
  page,
  context,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/editor/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: /News/ }).click();
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  await page.goto("/editor/news/create/");

  await page.locator('input[name="contentId"]').fill(contentId);
  await page.locator('input[name="title"]').fill("Browser foundation news");
  await page.locator('input[name="date"]').fill("2026-08-09");
  await page.locator('input[name="show_on_home"]').check();
  await expect(page.locator("[data-create-save]")).toBeDisabled();
  await expect(page.locator("[data-create-preview]")).toBeDisabled();

  await page.locator('input[name="show_on_home"]').uncheck();
  await expect(page.locator("[data-create-save]")).toBeEnabled();
  const previewPagePromise = context.waitForEvent("page");
  await page.locator("[data-create-preview]").click();
  const previewPage = await previewPagePromise;
  await expect(previewPage.getByText("Browser foundation news")).toBeVisible();
  await previewPage.close();

  await page.locator("[data-create-save]").click();
  await page.waitForURL(`**/editor/news/workspace/${contentId}/`);
  await expect(page.locator("[data-news-action-status]")).toContainText(
    "Saved · publish available",
  );
  const initialPublishResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/editor/api/news-publish/${contentId}`) &&
      response.request().method() === "POST",
  );
  await page.locator("[data-publish-news]").click();
  expect((await initialPublishResponse).ok()).toBe(true);
  await expect(page.locator("[data-news-action-status]")).toContainText(
    "Saved · publish available",
  );
  await expect(page.locator("[data-publish-news]")).toBeEnabled();

  await page.locator("[data-rename-destination]").fill(renamedId);
  await page.locator("[data-rename-plan]").click();
  await expect(page.locator("[data-rename-review]")).toBeVisible();
  await page.locator("[data-rename-confirm]").check();
  await page.locator("[data-rename-execute]").click();
  await page.waitForURL(`**/editor/news/workspace/${renamedId}/`);
  const renamedPublishResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/editor/api/news-publish/${renamedId}`) &&
      response.request().method() === "POST",
  );
  await page.locator("[data-publish-news]").click();
  expect((await renamedPublishResponse).ok()).toBe(true);
  await expect(page.locator("[data-news-action-status]")).toContainText(
    "Saved · publish available",
  );
  await expect(page.locator("[data-publish-news]")).toBeEnabled();

  const lockPath = path.join(
    repositoryRoot,
    ".kiki-editor/content-lifecycle/repository.lock",
  );
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(
    path.join(lockPath, "owner.json"),
    JSON.stringify({
      schemaVersion: 1,
      identity: "browser-lock",
      writer: "delete",
      operationId: "browser-lock",
      ownerPid: process.pid,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  );
  await page.locator('input[name="title"]').fill("Blocked by lifecycle lock");
  await page.locator("[data-save-news]").click();
  await expect(page.locator("[data-news-action-status]")).toContainText(
    "Another content lifecycle operation",
  );
  rmSync(lockPath, { recursive: true });
  await page.reload();

  const backupRoot = path.join(path.dirname(repositoryRoot), "backup");
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "src/editor/backup-cli.ts",
      "create",
      backupRoot,
    ],
    { cwd: repositoryRoot },
  );
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "src/editor/backup-cli.ts",
      "verify",
      backupRoot,
    ],
    { cwd: repositoryRoot },
  );
  await page.locator("[data-delete-backup]").fill(backupRoot);
  const deletePlanResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/editor/api/news-delete") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.action === "plan",
  );
  await page.locator("[data-delete-plan]").click();
  const deletePlanResponse = await deletePlanResponsePromise;
  const deletePlanResult = (await deletePlanResponse.json()) as {
    code?: string;
    error?: string;
  };
  expect(
    deletePlanResponse.ok(),
    `Delete plan failed (${deletePlanResponse.status()}): ${deletePlanResult.code ?? "unknown"} · ${deletePlanResult.error ?? "unknown error"}`,
  ).toBe(true);
  await expect(page.locator("[data-delete-review]")).toBeVisible();
  await page.locator("[data-delete-confirm]").check();
  await page.locator("[data-delete-execute]").click();
  await expect(page.locator("[data-delete-status]")).toContainText(
    "Delete complete",
  );
  await page.locator("[data-delete-publish]").click();
  await page.waitForURL("**/editor/news/workspace/");
  expect(browserErrors).toEqual([]);
});
