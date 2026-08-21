import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function openCollectionWorkspace(page: Page, collection: string) {
  await page.goto("/editor/");
  await page.getByRole("link", { name: new RegExp(collection, "i") }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(collection, "i") }),
  ).toBeVisible();
  await page
    .locator(`a[href^="/editor/${collection}/workspace/"]`)
    .first()
    .click();
  await page.waitForURL(`**/editor/${collection}/workspace/**`);
}

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

async function publish(
  page: Page,
  button: string,
  endpoint: RegExp,
  status: string,
) {
  const responsePromise = page.waitForResponse(
    (response) =>
      endpoint.test(response.url()) && response.request().method() === "POST",
  );
  await page.locator(button).click();
  const response = await responsePromise;
  const result = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
  };
  expect(
    response.ok(),
    `Publish failed (${response.status()}): ${result.code ?? "unknown"} · ${result.error ?? "unknown error"}`,
  ).toBe(true);
  await expect(page.locator(status)).toContainText("Published");
}

test("Artists operator flow validates, previews, saves, and publishes", async ({
  page,
  context,
}) => {
  const contentId = "browser-acceptance-artist";
  const biography = "Browser acceptance preview biography.";
  await page.goto("/editor/artists/create/");

  await page.locator('input[name="contentId"]').fill(contentId);
  await page.locator('input[name="name"]').fill("Browser Acceptance Artist");
  await page.locator('input[name="display_name"]').fill("ブラウザ受入作家");
  await page.locator('input[name="medium_label"]').fill("陶芸");
  await page.locator('input[name="en.medium_label"]').fill("Ceramics");
  await page.locator('textarea[name="medium"]').fill("Ceramics");
  await page
    .locator('textarea[name="short_bio"]')
    .fill("Test-only Artist created by the isolated browser fixture.");
  await page.locator('textarea[name="biography"]').fill(biography);
  await page
    .locator('input[name="hero.image"]')
    .fill("/images/artists/alana-wilson.png");
  await page
    .locator('textarea[name="hero_alt"]')
    .fill("Browser acceptance Artist fixture");
  const layout = page.locator('textarea[name="works_layout"]');
  await layout.fill("[");
  await expect(page.locator("[data-create-save]")).toBeDisabled();
  await expect(page.locator("[data-create-preview]")).toBeDisabled();

  await layout.fill("[]");
  await expect(page.locator("[data-create-save]")).toBeEnabled();

  const preview = await openPreview(
    context,
    page.locator("[data-create-preview]"),
  );
  await expect(preview.locator(".artists-bio-text")).toContainText(biography);
  await preview.close();

  await page.locator("[data-create-save]").click();
  await page.waitForURL(`**/editor/artists/workspace/${contentId}/`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('textarea[name="biography"]')).toHaveValue(
    biography,
  );
  await expect(page.locator("[data-publish-artists]")).toBeEnabled();
  await publish(
    page,
    "[data-publish-artists]",
    /\/editor\/api\/artists-publish\//,
    "[data-artists-action-status]",
  );
  const editedBiography = `${biography} Edited in the canonical three-file workspace.`;
  await page.locator('textarea[name="biography"]').fill(editedBiography);
  const jaPreview = await openPreview(
    context,
    page.locator('[data-preview-artists="ja"]'),
  );
  await expect(jaPreview.locator(".artists-bio-text")).toContainText(
    editedBiography,
  );
  await jaPreview.close();
  await page.locator("[data-save-artists]").click();
  await expect(page.locator("[data-artists-action-status]")).toContainText(
    "Saved",
  );
  await publish(
    page,
    "[data-publish-artists]",
    /\/editor\/api\/artists-publish\//,
    "[data-artists-action-status]",
  );
  const renamedId = `${contentId}-renamed`;
  await page.locator("[data-rename-destination]").fill(renamedId);
  await page.locator("[data-rename-plan]").click();
  await expect(page.locator("[data-rename-review]")).toBeVisible();
  await page.locator("[data-rename-confirm]").check();
  await page.locator("[data-rename-execute]").click();
  await page.waitForURL(`**/editor/artists/workspace/${renamedId}/`);
  await expect(page.locator("[data-publish-artists]")).toBeEnabled();
  await publish(
    page,
    "[data-publish-artists]",
    /\/editor\/api\/artists-publish\//,
    "[data-artists-action-status]",
  );
  await expect(page.locator("[data-delete-plan]")).toBeDisabled();
  await expect(page.locator("[data-delete-status]")).toContainText("backup");
});

test("Artists JA and EN previews render shared visible Hero and localized Works", async ({
  page,
  context,
}) => {
  for (const publicPath of [
    "/artists/reiko-kinoshita/",
    "/en/artists/reiko-kinoshita/",
  ]) {
    await page.goto(publicPath);
    const publicHero = page.locator(".artists-bio-image img");
    await expect(publicHero).toBeVisible();
    await expect
      .poll(() =>
        publicHero.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(page.locator(".artists-bio-image")).toHaveCSS("opacity", "1");
  }

  await page.goto("/editor/artists/workspace/reiko-kinoshita/");
  await page.waitForLoadState("networkidle");

  for (const locale of ["ja", "en"] as const) {
    const preview = await openPreview(
      context,
      page.locator(`[data-preview-artists="${locale}"]`),
    );
    await expect(preview.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      preview.locator("[data-artist-detail-presentation]"),
    ).toHaveAttribute("data-locale", locale);

    const hero = preview.locator(".artists-bio-image img");
    await expect(hero).toHaveAttribute(
      "src",
      "/images/artists/reiko-kinoshita.png",
    );
    await expect(hero).toBeVisible();
    await expect
      .poll(() =>
        hero.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(preview.locator(".artists-bio-image")).toHaveCSS(
      "opacity",
      "1",
    );

    const workImages = preview.locator(".artists-works-image");
    await expect(workImages).toHaveCount(6);
    for (const image of await workImages.all()) {
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((element: HTMLImageElement) => element.naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    await preview.close();
  }
});

test("Exhibitions operator flow validates, previews, saves, and publishes", async ({
  page,
  context,
}) => {
  const contentId = "browser-acceptance-exhibition";
  const createTitle = "Browser Acceptance Exhibition Draft";
  await page.goto("/editor/exhibitions/create/");

  await page.locator('input[name="contentId"]').fill(contentId);
  await page
    .locator('textarea[name="shared.artists"]')
    .fill("browser-acceptance-artist");
  await page.locator('input[name="shared.start_date"]').fill("2026-08-09");
  await page.locator('input[name="shared.end_date"]').fill("2026-08-10");
  await page.locator('input[name="shared.opening_hours.opens"]').fill("13:00");
  await page.locator('input[name="shared.opening_hours.closes"]').fill("17:00");
  await page.locator('input[name="shared.closed_weekdays.known"]').check();
  await page.locator('input[name="shared.closed_weekdays"][value="wed"]').check();
  await page.locator('input[name="shared.closed_weekdays"][value="thu"]').check();
  await page.locator('input[name="ja.title"]').fill(createTitle);
  await page.locator('input[name="ja.venue"]').fill("KiKi Gallery");
  await page
    .locator('textarea[name="ja.body"]')
    .fill("Test-only Exhibition created by the isolated browser fixture.");
  await page
    .locator('input[name="shared.hero.image"]')
    .fill("/images/exhibitions/alana-wilson-2024-04.png");
  await page
    .locator('select[name="shared.hero.orientation"]')
    .selectOption("portrait");
  await page
    .locator('textarea[name="ja.hero_alt"]')
    .fill("Browser acceptance Exhibition fixture");
  const hero = page.locator('input[name="shared.hero.image"]');
  const originalHero = await hero.inputValue();
  await hero.fill("");
  await expect(page.locator("[data-create-save]")).toBeDisabled();
  await expect(page.locator("[data-create-preview]")).toBeDisabled();

  await hero.fill(originalHero);
  await expect(page.locator("[data-create-save]")).toBeEnabled();

  const preview = await openPreview(
    context,
    page.locator("[data-create-preview]"),
  );
  await expect(preview.getByText(createTitle, { exact: true })).toBeVisible();
  await preview.close();

  await page.locator("[data-create-save]").click();
  await page.waitForURL(`**/editor/exhibitions/workspace/${contentId}/`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForURL(`**/editor/exhibitions/workspace/${contentId}/`);
  const canonicalTitle = page.locator('input[name="ja.title"]');
  await expect(canonicalTitle).toBeVisible();
  await expect(canonicalTitle).toHaveValue(createTitle);

  const savedTitle = `${await canonicalTitle.inputValue()} · saved`;
  await canonicalTitle.fill(savedTitle);
  await expect(canonicalTitle).toHaveValue(savedTitle);
  await expect(page.locator("[data-save-exhibitions]")).toBeEnabled();
  const saveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/editor/api/exhibitions/${contentId}`) &&
      response.request().method() === "POST",
  );
  await page.locator("[data-save-exhibitions]").click();
  const saveResponse = await saveResponsePromise;
  expect(
    saveResponse.ok(),
    `Exhibition Save failed (${saveResponse.status()}): ${await saveResponse.text()}`,
  ).toBe(true);
  await expect(page.locator("[data-exhibitions-action-status]")).toContainText(
    "Saved · unpublished changes ready to publish",
  );
  await expect(page.locator("[data-publish-exhibitions]")).toBeEnabled();
  await publish(
    page,
    "[data-publish-exhibitions]",
    /\/editor\/api\/exhibitions-publish\//,
    "[data-exhibitions-action-status]",
  );
});

test("Exhibitions JA and EN previews render the current draft through public presentation", async ({
  page,
  context,
}) => {
  const contentId = "group-exhibition-2026-03";
  await page.goto(`/editor/exhibitions/workspace/${contentId}/`);

  const previewJaButton = page.locator('[data-preview-exhibitions="ja"]');
  const previewEnButton = page.locator('[data-preview-exhibitions="en"]');
  await expect(previewJaButton).toBeEnabled();
  await expect(previewEnButton).toBeEnabled();

  await page
    .locator('input[name="ja.attendance"]')
    .fill("JA unsaved attendance");
  await page.locator('input[name="shared.opening_hours.opens"]').fill("12:30");
  await page.locator('input[name="shared.closed_weekdays"][value="thu"]').uncheck();
  await page.locator('input[name="shared.closed_weekdays"][value="fri"]').check();
  await expect(page.locator("[data-publish-exhibitions]")).toBeDisabled();
  const jaPreview = await openPreview(context, previewJaButton);
  await expect(
    jaPreview.locator(
      '[data-exhibition-detail-presentation][data-locale="ja"]',
    ),
  ).toBeVisible();
  await expect(jaPreview.getByText("JA unsaved attendance")).toBeVisible();
  await expect(jaPreview.getByText("12:30–17:00")).toBeVisible();
  await expect(jaPreview.getByText("水曜・金曜")).toBeVisible();
  await expect(jaPreview.getByText("木下令子、森夕香")).toBeVisible();
  await expect(jaPreview.locator(".exhibitions-work")).toHaveCount(2);
  await expect(
    jaPreview.getByRole("link", { name: "View All Exhibitions" }),
  ).toHaveAttribute("href", "/exhibitions/");
  await jaPreview.close();

  await page
    .locator('input[name="en.attendance"]')
    .fill("EN unsaved attendance");
  const enPreview = await openPreview(context, previewEnButton);
  await expect(
    enPreview.locator(
      '[data-exhibition-detail-presentation][data-locale="en"]',
    ),
  ).toBeVisible();
  await expect(enPreview.getByText("EN unsaved attendance")).toBeVisible();
  await expect(enPreview.getByText("12:30–17:00")).toBeVisible();
  await expect(enPreview.getByText("Wednesday and Friday")).toBeVisible();
  await expect(enPreview.getByText("Reiko Kinoshita, Yuka Mori")).toBeVisible();
  await expect(enPreview.getByText("Artist attendance")).toBeVisible();
  await expect(enPreview.getByRole("heading", { name: "Venue" })).toHaveCount(0);
  await expect(enPreview.locator(".exhibitions-work")).toHaveCount(0);
  await expect(
    enPreview.getByRole("link", { name: "View All Exhibitions" }),
  ).toHaveAttribute("href", "/en/exhibitions/");
  await enPreview.close();

  const publicJa = await context.newPage();
  await publicJa.goto(`/exhibitions/${contentId}/`);
  await expect(publicJa.getByText("13:00–17:00")).toBeVisible();
  await expect(publicJa.getByText("水曜・木曜")).toBeVisible();
  await expect(
    publicJa.locator('[data-exhibition-detail-presentation][data-locale="ja"]'),
  ).toBeVisible();
  await expect(publicJa.locator(".exhibitions-work")).toHaveCount(2);
  await expect(publicJa.locator(".exhibitions-artists-list a")).toHaveCount(2);
  await publicJa.close();

  const publicEn = await context.newPage();
  await publicEn.goto(`/en/exhibitions/${contentId}/`);
  await expect(publicEn.getByText("13:00–17:00")).toBeVisible();
  await expect(publicEn.getByText("Wednesday and Thursday")).toBeVisible();
  await expect(publicEn.getByRole("heading", { name: "Venue" })).toHaveCount(0);
  await expect(
    publicEn.locator('[data-exhibition-detail-presentation][data-locale="en"]'),
  ).toBeVisible();
  await expect(publicEn.locator(".exhibitions-work")).toHaveCount(0);
  await expect(publicEn.locator(".exhibitions-artists-list a")).toHaveCount(2);
  await publicEn.close();
});

test("Exhibitions three-file Rename publishes exact paths and Delete fails closed without backup", async ({
  page,
}) => {
  const repository = process.env.KIKI_BROWSER_REPOSITORY!;
  const sourceId = "alana-wilson-2027-04";
  const destinationId = `${sourceId}-renamed`;
  await page.goto(`/editor/exhibitions/workspace/${sourceId}/`);

  await page.locator("[data-rename-destination]").fill(destinationId);
  await page.locator("[data-rename-plan]").click();
  await expect(page.locator("[data-rename-review]")).toBeVisible();
  for (const name of ["en.md", "index.yaml", "ja.md"])
    await expect(page.locator("[data-rename-files]")).toContainText(name);
  await expect(page.locator("[data-rename-references]")).toContainText(
    "src/content/news/2027-03-05/index.yaml",
  );
  await page.locator("[data-rename-confirm]").check();
  await page.locator("[data-rename-execute]").click();
  await page.waitForURL(`**/editor/exhibitions/workspace/${destinationId}/`);

  const sourceDirectory = path.join(
    repository,
    "src/content/exhibitions",
    sourceId,
  );
  const destinationDirectory = path.join(
    repository,
    "src/content/exhibitions",
    destinationId,
  );
  await expect(
    access(sourceDirectory)
      .then(() => true)
      .catch(() => false),
  ).resolves.toBe(false);
  await expect(readdir(destinationDirectory)).resolves.toEqual([
    "en.md",
    "index.yaml",
    "ja.md",
  ]);
  await expect(
    readFile(
      path.join(repository, "src/content/news/2027-03-05/index.yaml"),
      "utf8",
    ),
  ).resolves.toContain(`/exhibitions/${destinationId}`);

  await publish(
    page,
    "[data-publish-exhibitions]",
    /\/editor\/api\/exhibitions-publish\//,
    "[data-exhibitions-action-status]",
  );
  const publishedPaths = execFileSync(
    "git",
    ["show", "--no-renames", "--pretty=format:", "--name-only", "HEAD"],
    { cwd: repository, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .sort();
  expect(publishedPaths).toEqual(
    [
      `src/content/exhibitions/${sourceId}/en.md`,
      `src/content/exhibitions/${sourceId}/index.yaml`,
      `src/content/exhibitions/${sourceId}/ja.md`,
      `src/content/exhibitions/${destinationId}/en.md`,
      `src/content/exhibitions/${destinationId}/index.yaml`,
      `src/content/exhibitions/${destinationId}/ja.md`,
      "src/content/news/2027-03-05/index.yaml",
    ].sort(),
  );

  await expect(page.locator("[data-delete-plan]")).toBeDisabled();
  await expect(page.locator("[data-delete-status]")).toContainText("backup");
});

test("Journal keeps locale preview isolated and blocks TODO publishing", async ({
  page,
  context,
}) => {
  await openCollectionWorkspace(page, "journal");

  const jaTitle = page.locator('input[name="ja.title"]');
  const enTitle = page.locator('input[name="en.title"]');
  const originalEnTitle = await enTitle.inputValue();
  const isolatedJaTitle = "ブラウザ受入 JA ロケール限定";
  await jaTitle.fill(isolatedJaTitle);
  await enTitle.fill("");

  await expect(page.locator('[data-preview-journal="ja"]')).toBeEnabled();
  await expect(page.locator('[data-preview-journal="en"]')).toBeDisabled();
  await expect(page.locator("[data-publish-journal]")).toBeDisabled();

  const jaPreview = await openPreview(
    context,
    page.locator('[data-preview-journal="ja"]'),
  );
  await expect(jaPreview.locator('article[lang="ja"]')).toBeVisible();
  await expect(
    jaPreview.getByText(isolatedJaTitle, { exact: true }),
  ).toBeVisible();
  await expect(
    jaPreview.getByText(originalEnTitle, { exact: true }),
  ).toHaveCount(0);
  await jaPreview.close();

  await enTitle.fill("__TODO_EN_TITLE__");
  await expect(page.locator("[data-save-journal]")).toBeEnabled();
  await expect(page.locator('[data-preview-journal="en"]')).toBeDisabled();
  await expect(page.locator("[data-publish-journal]")).toBeDisabled();
  await expect(page.locator("[data-issues]")).toContainText(
    "content.placeholder",
  );

  await page.locator("[data-save-journal]").click();
  await expect(page.locator("[data-action-status]")).toContainText(
    "Saved to canonical files",
  );
  await expect(page.locator("[data-publish-journal]")).toBeDisabled();

  await enTitle.fill(originalEnTitle);
  await page.locator("[data-save-journal]").click();
  await expect(page.locator("[data-action-status]")).toContainText(
    "Saved to canonical files",
  );
  await publish(
    page,
    "[data-publish-journal]",
    /\/editor\/api\/journal-publish\//,
    "[data-action-status]",
  );
});

test("Home exposes only the singleton edit flow and publishes it", async ({
  page,
  context,
}) => {
  await page.goto("/editor/");
  await page.getByRole("link", { name: /Home/ }).click();
  await page.waitForURL("**/editor/home/workspace/home/");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Create|Rename|Delete/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Create|Rename|Delete/ }),
  ).toHaveCount(0);

  const sectionTitle = page.locator('input[name="section_0_title"]');
  const originalSectionTitle = await sectionTitle.inputValue();
  await sectionTitle.fill("");
  await expect(page.locator("[data-save-home]")).toBeDisabled();
  await expect(page.locator("[data-preview-home]")).toBeDisabled();

  const updatedTitle = `${originalSectionTitle} browser acceptance`;
  await sectionTitle.fill(updatedTitle);
  await expect(page.locator("[data-save-home]")).toBeEnabled();
  const preview = await openPreview(
    context,
    page.locator("[data-preview-home]"),
  );
  await expect(preview.getByText(updatedTitle, { exact: true })).toBeVisible();
  await preview.close();

  await page.locator("[data-save-home]").click();
  await expect(page.locator("[data-home-action-status]")).toContainText(
    "Saved · unpublished changes ready to publish",
  );
  await publish(
    page,
    "[data-publish-home]",
    /\/editor\/api\/home-publish$/,
    "[data-home-action-status]",
  );
});
