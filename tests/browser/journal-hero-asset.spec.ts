import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const repository = process.env.KIKI_BROWSER_REPOSITORY!;
const contentId = "report-yuka-mori-2025-07";
const publicPath = `/journal/${contentId}/`;
const title = "森由香展レポート";
const oldHero = "/images/journal/report-yuka-mori-2025-07-1.webp";
const replacementSource = path.join(
  repository,
  "public/images/journal/report-yuka-mori-2025-07-2.webp",
);
const replacementHero = `/images/journal/${contentId}.webp`;
const replacementTarget = path.join(repository, "public", replacementHero);
const indexFile = path.join(
  repository,
  "src/content/journal",
  contentId,
  "index.yaml",
);
const evidenceFile = path.join(
  repository,
  ".kiki-editor/publish-evidence/hero-assets/journal",
  `${contentId}.v1.json`,
);

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function openPreview(
  context: BrowserContext,
  trigger: ReturnType<Page["locator"]>,
) {
  const previewPromise = context.waitForEvent("page");
  await trigger.click();
  const preview = await previewPromise;
  await preview.waitForLoadState("domcontentloaded");
  return preview;
}

async function publicJournalState(page: Page) {
  const response = await page.request.get(publicPath, {
    headers: { "cache-control": "no-cache" },
  });
  const body = await response.text();
  const heroStart = body.indexOf('class="article-hero"');
  const heroEnd = heroStart < 0 ? -1 : body.indexOf("</figure>", heroStart);
  const heroMarkup =
    heroStart < 0 || heroEnd < 0 ? "" : body.slice(heroStart, heroEnd);
  return {
    status: response.status(),
    hasTitle: body.includes(title),
    hasOldHero: heroMarkup.includes(oldHero),
    hasReplacementHero: heroMarkup.includes(replacementHero),
  };
}

async function openStableWorkspace(page: Page, expectedHero: string) {
  await expect
    .poll(async () => {
      try {
        const response = await page.goto(
          `/editor/journal/workspace/${contentId}/`,
          { waitUntil: "networkidle" },
        );
        if (!response?.ok()) return undefined;
        return await page.locator("[data-journal-hero-path]").inputValue();
      } catch {
        return undefined;
      }
    })
    .toBe(expectedHero);
}

async function expectLoadedHero(
  page: Page,
  expectedSrc: string,
  expectedHash: string,
) {
  const hero = page.locator(".article-hero img");
  await expect(hero).toHaveAttribute("src", expectedSrc);
  await expect(hero).toBeVisible();
  await expect
    .poll(() => hero.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const response = await page.request.get(expectedSrc, {
    headers: { "cache-control": "no-cache" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect(sha256(await response.body())).toBe(expectedHash);
}

test("Journal existing Hero replacement previews, saves, publishes, and converges", async ({
  page,
  context,
}) => {
  const initialIndex = await fs.readFile(indexFile, "utf8");
  const oldBytes = await fs.readFile(path.join(repository, "public", oldHero));
  const replacementBytes = await fs.readFile(replacementSource);
  const oldHash = sha256(oldBytes);
  const replacementHash = sha256(replacementBytes);
  expect(replacementHash).not.toBe(oldHash);

  // A same-format canonical target exercises the reviewed Replace comparison
  // without changing the currently referenced legacy Hero before Save.
  await fs.copyFile(
    path.join(repository, "public", oldHero),
    replacementTarget,
  );
  expect(sha256(await fs.readFile(replacementTarget))).toBe(oldHash);

  await openStableWorkspace(page, oldHero);
  await expect(page.locator("[data-journal-hero-thumbnail]")).toBeVisible();
  await expect(page.locator("[data-journal-hero-canonical-path]")).toHaveText(
    oldHero,
  );
  await expect(page.locator("[data-journal-hero-state]")).toHaveText(
    "Canonical · saved",
  );
  await expect(page.locator("[data-save-journal]")).toBeDisabled();
  await expect(publicJournalState(page)).resolves.toEqual({
    status: 200,
    hasTitle: true,
    hasOldHero: true,
    hasReplacementHero: false,
  });

  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/editor/api/journal-hero/upload/${contentId}`) &&
      response.request().method() === "POST",
  );
  await page
    .locator("[data-journal-hero-file]")
    .setInputFiles(replacementSource);
  const upload = await uploadResponse;
  expect(upload.ok()).toBe(true);
  const uploadResult = (await upload.json()) as {
    state: string;
    asset: { sha256: string; proposedSrc: string };
  };
  expect(uploadResult.state).toBe("replace-confirmation");
  expect(uploadResult.asset.sha256).toBe(replacementHash);
  expect(uploadResult.asset.proposedSrc).toBe(replacementHero);

  const comparison = page.locator("[data-journal-hero-confirm]");
  await expect(comparison).toBeVisible();
  await expect(
    comparison.locator("figure").first().locator("img"),
  ).toHaveAttribute("src", oldHero);
  const temporaryComparison = comparison.locator("[data-journal-hero-new]");
  await expect(temporaryComparison).toBeVisible();
  await expect
    .poll(() =>
      temporaryComparison.evaluate(
        (image: HTMLImageElement) => image.naturalWidth,
      ),
    )
    .toBeGreaterThan(0);
  await page.locator("[data-journal-hero-accept]").click();
  await expect(page.locator("[data-journal-hero-state]")).toContainText(
    "Replacement pending",
  );
  await expect(page.locator("[data-save-journal]")).toBeEnabled();
  await expect(page.locator("[data-publish-journal]")).toBeDisabled();
  expect(await fs.readFile(indexFile, "utf8")).toBe(initialIndex);
  expect(sha256(await fs.readFile(replacementTarget))).toBe(oldHash);
  await expect(publicJournalState(page)).resolves.toEqual({
    status: 200,
    hasTitle: true,
    hasOldHero: true,
    hasReplacementHero: false,
  });

  const preview = await openPreview(
    context,
    page.locator('[data-preview-journal="ja"]'),
  );
  await expect(preview).toHaveURL(/\/editor\/preview\/journal\/[^/]+\/ja\/?$/);
  const temporaryHero = preview.locator(".article-hero img");
  await expect(temporaryHero).toBeVisible();
  const temporarySrc = await temporaryHero.getAttribute("src");
  expect(temporarySrc).toMatch(
    new RegExp(
      `^/editor/api/journal-hero-preview/${contentId}/[^/]+/[a-f0-9]{64}$`,
    ),
  );
  await expect
    .poll(() =>
      temporaryHero.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  const temporaryResponse = await preview.request.get(temporarySrc!);
  expect(temporaryResponse.status()).toBe(200);
  expect(temporaryResponse.headers()["content-type"]).toBe("image/webp");
  expect(temporaryResponse.headers()["cache-control"]).toBe(
    "private, no-store",
  );
  expect(sha256(await temporaryResponse.body())).toBe(replacementHash);
  await preview.close();

  expect(await fs.readFile(indexFile, "utf8")).toBe(initialIndex);
  expect(sha256(await fs.readFile(replacementTarget))).toBe(oldHash);
  await expect(publicJournalState(page)).resolves.toEqual({
    status: 200,
    hasTitle: true,
    hasOldHero: true,
    hasReplacementHero: false,
  });

  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/editor/api/journal/${contentId}`) &&
      response.request().method() === "POST",
  );
  await page.locator("[data-save-journal]").click();
  const saved = await saveResponse;
  expect(saved.ok()).toBe(true);
  const saveResult = (await saved.json()) as {
    draft: { shared: { state: string; value: { hero: { image: string } } } };
  };
  expect(saveResult.draft.shared.state).toBe("editable");
  expect(saveResult.draft.shared.value.hero.image).toBe(replacementHero);
  await expect
    .poll(async () =>
      (await fs.readFile(indexFile, "utf8")).includes(replacementHero),
    )
    .toBe(true);
  const materialized = await fs.readFile(replacementTarget);
  expect(materialized.byteLength).toBeGreaterThan(0);
  expect(sha256(materialized)).toBe(replacementHash);
  expect(
    sha256(await fs.readFile(path.join(repository, "public", oldHero))),
  ).toBe(oldHash);
  const evidence = JSON.parse(await fs.readFile(evidenceFile, "utf8")) as {
    state: string;
    assets: Array<{ src: string; sha256: string; mime: string }>;
  };
  expect(evidence.state).toBe("pending");
  expect(evidence.assets).toEqual([
    expect.objectContaining({
      src: replacementHero,
      sha256: replacementHash,
      mime: "image/webp",
    }),
  ]);

  await expect
    .poll(() => publicJournalState(page))
    .toEqual({
      status: 200,
      hasTitle: true,
      hasOldHero: false,
      hasReplacementHero: true,
    });
  await openStableWorkspace(page, replacementHero);
  await expect(page.locator("[data-journal-hero-state]")).toHaveText(
    "Canonical · saved",
  );
  await expect(page.locator("[data-save-journal]")).toBeDisabled();

  const savedPreview = await openPreview(
    context,
    page.locator('[data-preview-journal="ja"]'),
  );
  await expectLoadedHero(savedPreview, replacementHero, replacementHash);
  await savedPreview.close();

  const publishResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/editor/api/journal-publish/${contentId}`) &&
      response.request().method() === "POST",
  );
  await page.locator("[data-publish-journal]").click();
  const published = await publishResponse;
  const publishResult = (await published.json()) as {
    state?: string;
    code?: string;
    error?: string;
  };
  expect(
    published.ok(),
    `Publish failed (${published.status()}): ${publishResult.code ?? "unknown"} · ${publishResult.error ?? "unknown error"}`,
  ).toBe(true);
  expect(publishResult.state).toBe("published");
  await expect(page.locator("[data-action-status]")).toContainText("Published");
  await expect
    .poll(() =>
      fs.access(evidenceFile).then(
        () => false,
        () => true,
      ),
    )
    .toBe(true);

  // This mutation-owning scenario does not finish until Astro's public content
  // graph serves the exact published title and replacement Hero lineage.
  await expect
    .poll(() => publicJournalState(page))
    .toEqual({
      status: 200,
      hasTitle: true,
      hasOldHero: false,
      hasReplacementHero: true,
    });
  const publicPage = await context.newPage();
  await publicPage.goto(publicPath);
  await expect(publicPage.getByRole("heading", { name: title })).toBeVisible();
  await expectLoadedHero(publicPage, replacementHero, replacementHash);
  await publicPage.close();

  expect(
    sha256(await fs.readFile(path.join(repository, "public", oldHero))),
  ).toBe(oldHash);
});
