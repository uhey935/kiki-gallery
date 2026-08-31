import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const contentId = "interview-keisuke-matsuda-2026-02";
const workspace = `/editor/journal/workspace/${contentId}/`;
const canonicalFiles = ["index.yaml", "ja.md", "en.md"].map((name) =>
  path.join(repository, "src/content/journal", contentId, name),
);

const readCanonical = () =>
  Promise.all(canonicalFiles.map((file) => fs.readFile(file)));
const execFile = promisify(execFileCallback);

async function treeDigest(root: string) {
  const hash = createHash("sha256");
  const visit = async (directory: string) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target);
      hash.update(relative);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) hash.update(await fs.readFile(target));
    }
  };
  await visit(root);
  return hash.digest("hex");
}

test("Journal manual-recovery response latches a terminal workspace across reload", async ({
  page,
}) => {
  const before = await readCanonical();
  let saveRequests = 0;

  await page.route(`**/editor/api/journal/${contentId}`, async (route) => {
    saveRequests += 1;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Failed to roll back Journal Save",
        code: "journal-save-rollback-failed",
      }),
    });
  });

  await page.goto(workspace);
  await page.waitForLoadState("networkidle");
  const title = page.locator('input[name="ja.title"]');
  const originalTitle = await title.inputValue();
  const terminalDraft = `${originalTitle} manual recovery draft`;

  await expect(page.locator("[data-action-status]")).not.toContainText(
    "manual recovery",
  );
  await expect(title).toBeEnabled();
  await title.fill(terminalDraft);
  await expect(page.locator("[data-save-journal]")).toBeEnabled();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/editor/api/journal/${contentId}`) &&
      response.request().method() === "POST",
  );
  await page.locator("[data-save-journal]").click();
  const response = await responsePromise;

  expect({
    saveRequests,
    responseStatus: response.status(),
    responseCode: (await response.json()).code,
  }).toEqual({
    saveRequests: 1,
    responseStatus: 400,
    responseCode: "journal-save-rollback-failed",
  });
  await expect(page.locator("[data-action-status]")).toContainText(
    "Failed to roll back Journal Save",
  );
  await expect(page.locator("[data-action-status]")).toContainText(
    "Stop editing and request manual recovery before trying another operation.",
  );
  await expect(title).toHaveValue(terminalDraft);
  await expect(title).toBeDisabled();
  await expect(page.locator("[data-save-journal]")).toBeDisabled();
  await expect(page.locator("[data-publish-journal]")).toBeDisabled();
  await expect(page.locator("[data-rename-destination]")).toBeDisabled();
  await expect(page.locator("[data-delete-backup]")).toBeDisabled();

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+S" : "Control+S",
  );
  await expect.poll(() => saveRequests).toBe(1);
  expect(await readCanonical()).toEqual(before);

  page.once("dialog", (dialog) => dialog.accept());
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("[data-action-status]")).toContainText(
    "Failed to roll back Journal Save",
  );
  await expect(page.locator("[data-action-status]")).toContainText(
    "manual recovery",
  );
  await expect(page.locator('input[name="ja.title"]')).toBeDisabled();
  await expect(page.locator("[data-save-journal]")).toBeDisabled();
  await expect(page.locator("[data-publish-journal]")).toBeDisabled();
  await expect(page.locator("[data-rename-destination]")).toBeDisabled();
  await expect(page.locator("[data-delete-backup]")).toBeDisabled();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+S" : "Control+S",
  );
  await expect.poll(() => saveRequests).toBe(1);
  expect(await readCanonical()).toEqual(before);
});

test("durable Journal recovery evidence rejects a mutation from a new browser session", async ({
  page,
  browser,
}) => {
  const beforeCanonical = await readCanonical();
  const beforeAssets = await treeDigest(
    path.join(repository, "public/images/journal"),
  );
  const beforeHead = (
    await execFile("git", ["rev-parse", "HEAD"], { cwd: repository })
  ).stdout.trim();

  await page.goto(workspace);
  await page.waitForLoadState("networkidle");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem(
        "kiki-editor:manual-recovery:journal:interview-keisuke-matsuda-2026-02",
      ),
    ),
  ).toBeNull();

  const identity = randomUUID();
  const transaction = `.journal-save-${identity}`;
  const contentDirectory = path.dirname(canonicalFiles[0]);
  const stage = path.join(contentDirectory, `${transaction}-stage`);
  const backup = path.join(contentDirectory, `${transaction}-backup`);
  await fs.mkdir(stage);
  await fs.mkdir(backup);
  await fs.copyFile(canonicalFiles[2], path.join(stage, "en.md"));
  for (const file of canonicalFiles)
    await fs.copyFile(file, path.join(backup, path.basename(file)));
  const evidenceBefore = await treeDigest(backup);
  const statusWithEvidence = (
    await execFile("git", ["status", "--porcelain=v1"], { cwd: repository })
  ).stdout;

  const secondContext = await browser.newContext({
    baseURL: process.env.KIKI_BROWSER_BASE_URL,
  });
  const secondPage = await secondContext.newPage();
  try {
    await secondPage.goto(workspace);
    await secondPage.waitForLoadState("networkidle");
    expect(
      await secondPage.evaluate(() =>
        sessionStorage.getItem(
          "kiki-editor:manual-recovery:journal:interview-keisuke-matsuda-2026-02",
        ),
      ),
    ).toBeNull();

    const title = secondPage.locator('input[name="ja.title"]');
    await title.fill(`${await title.inputValue()} blocked in new session`);
    const responsePromise = secondPage.waitForResponse(
      (response) =>
        response.url().endsWith(`/editor/api/journal/${contentId}`) &&
        response.request().method() === "POST",
    );
    await secondPage.locator("[data-save-journal]").click();
    const response = await responsePromise;
    const result = (await response.json()) as {
      code?: string;
      recoveryReference?: string;
    };
    expect(response.status()).toBe(409);
    expect(result).toMatchObject({
      code: "journal-manual-recovery-required",
      recoveryReference: `src/content/journal/${contentId}/${transaction}`,
    });
    await expect(secondPage.locator("[data-action-status]")).toContainText(
      "manual recovery",
    );
    await expect(secondPage.locator("[data-save-journal]")).toBeDisabled();
    await expect(secondPage.locator("[data-publish-journal]")).toBeDisabled();
  } finally {
    await secondContext.close();
  }

  expect(await readCanonical()).toEqual(beforeCanonical);
  expect(await treeDigest(path.join(repository, "public/images/journal"))).toBe(
    beforeAssets,
  );
  expect(await treeDigest(backup)).toBe(evidenceBefore);
  expect(await fs.readdir(stage)).toEqual(["en.md"]);
  expect(
    (
      await execFile("git", ["rev-parse", "HEAD"], { cwd: repository })
    ).stdout.trim(),
  ).toBe(beforeHead);
  expect(
    (await execFile("git", ["status", "--porcelain=v1"], { cwd: repository }))
      .stdout,
  ).toBe(statusWithEvidence);
});
