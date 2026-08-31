import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const homeUnit = path.join(repository, "src/content/home/home");
const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const git = (args: string[]) =>
  execFileSync("git", args, { cwd: repository, encoding: "utf8" });

async function treeSnapshot(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile())
        snapshot[path.relative(root, absolute)] = sha256(
          await readFile(absolute),
        );
    }
  };
  await visit(root);
  return snapshot;
}

test("a stale Home tab cannot Save or Publish over a concurrent tab", async ({
  context,
}) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  const fieldA = tabA.getByLabel("About intro · Required").first();
  const fieldB = tabB.getByLabel("About intro · Required").first();
  const canonicalFile = path.join(homeUnit, "ja.md");
  const unrelatedFile = path.join(repository, "src/content/about/about/en.md");
  const publicHome = path.join(repository, "public/images/home");
  const editorEvidence = path.join(repository, ".kiki-editor");

  await Promise.all([
    tabA.goto("/editor/home/workspace/home/"),
    tabB.goto("/editor/home/workspace/home/"),
  ]);
  const initialA = await fieldA.inputValue();
  const initialB = await fieldB.inputValue();
  expect(initialB).toBe(initialA);
  const gitHeadBefore = git(["rev-parse", "HEAD"]);
  const unrelatedBefore = await readFile(unrelatedFile);
  const publicBefore = await treeSnapshot(publicHome);
  const evidenceBefore = await treeSnapshot(editorEvidence);

  const valueA = `${initialA} Concurrent owner A`;
  await fieldA.fill(valueA);
  const saveAResponsePromise = tabA.waitForResponse(
    (response) =>
      response.url().endsWith("/editor/api/home") &&
      response.request().method() === "POST",
  );
  await tabA.getByRole("button", { name: "Save" }).click();
  const saveAResponse = await saveAResponsePromise;
  expect(saveAResponse.status()).toBe(200);
  expect((await saveAResponse.json()).draft.locales.ja.value.about_intro).toBe(
    valueA,
  );
  await expect
    .poll(async () => (await readFile(canonicalFile, "utf8")).includes(valueA))
    .toBe(true);
  const canonicalAfterA = await treeSnapshot(homeUnit);
  const gitStatusAfterA = git(["status", "--porcelain=v1", "-z"]);

  // Vite observes the write, but the open workspace must retain its own baseline.
  await expect(fieldB).toHaveValue(initialB);
  await expect(tabB.getByRole("button", { name: "Publish" })).toBeEnabled();

  const publishBResponsePromise = tabB.waitForResponse(
    (response) =>
      response.url().endsWith("/editor/api/home-publish") &&
      response.request().method() === "POST",
  );
  await tabB.getByRole("button", { name: "Publish" }).click();
  const publishBResponse = await publishBResponsePromise;
  expect(publishBResponse.status()).toBe(400);
  expect(await publishBResponse.json()).toEqual({
    error: "Saved baseline does not match canonical Home",
    code: "canonical-mismatch",
  });
  await expect(tabB.locator("[data-home-action-status]")).toHaveText(
    "Saved baseline does not match canonical Home",
  );

  const valueB = `${initialB} Rejected stale writer B`;
  await fieldB.fill(valueB);
  const saveBResponsePromise = tabB.waitForResponse(
    (response) =>
      response.url().endsWith("/editor/api/home") &&
      response.request().method() === "POST",
  );
  await tabB.getByRole("button", { name: "Save" }).click();
  const saveBResponse = await saveBResponsePromise;
  expect(saveBResponse.status()).toBe(400);
  expect(await saveBResponse.json()).toEqual({
    error: "Canonical Home changed after load",
    code: "canonical-mismatch",
  });
  await expect(tabB.locator("[data-home-action-status]")).toHaveText(
    "Canonical Home changed after load",
  );
  await expect(fieldB).toHaveValue(valueB);
  await expect(tabB.getByRole("button", { name: "Save" })).toBeEnabled();
  await expect(tabB.getByRole("button", { name: "Publish" })).toBeDisabled();

  expect(await treeSnapshot(homeUnit)).toEqual(canonicalAfterA);
  expect((await readFile(canonicalFile, "utf8")).includes(valueA)).toBe(true);
  expect((await readFile(canonicalFile, "utf8")).includes(valueB)).toBe(false);
  expect(await readFile(unrelatedFile)).toEqual(unrelatedBefore);
  expect(await treeSnapshot(publicHome)).toEqual(publicBefore);
  expect(await treeSnapshot(editorEvidence)).toEqual(evidenceBefore);
  expect(git(["rev-parse", "HEAD"])).toBe(gitHeadBefore);
  expect(git(["status", "--porcelain=v1", "-z"])).toBe(gitStatusAfterA);
});
