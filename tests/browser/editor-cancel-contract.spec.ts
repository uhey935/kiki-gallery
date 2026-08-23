import { expect, test, type Page } from "@playwright/test";

const contentIds = {
  artists: "keisuke-matsuda",
  exhibitions: "reiko-kinoshita-2023-12",
  works: "reiko-kinoshita-02",
  journal: "interview-keisuke-matsuda-2026-02",
  news: "2026-02-14",
  home: "home",
  about: "about",
} as const;

async function openWorkspace(page: Page, collection: keyof typeof contentIds) {
  await page.goto(`/editor/${collection}/workspace/${contentIds[collection]}/`);
  await page.waitForLoadState("networkidle");
}

const collections = [
  ["artists", 'textarea[name="short_bio"]'],
  ["exhibitions", 'textarea[name="ja.body"]'],
  ["works", 'input[name="title"]'],
  ["journal", 'textarea[name="ja.body"]'],
  ["news", 'input[name="shared.show_on_home"]'],
  ["home", 'textarea[name="ja_about_intro"]'],
  ["about", 'textarea[name="ja_address"]'],
] as const;

for (const [collection, fieldSelector] of collections) {
  test(`${collection} Cancel restores its saved draft and clears dirty state`, async ({
    page,
  }) => {
    await openWorkspace(page, collection);
    const cancel = page.locator(`[data-cancel-${collection}]`);
    const save = page.locator(`[data-save-${collection}]`);
    const field = page.locator(fieldSelector);
    const checkbox = await field.getAttribute("type");
    const saved =
      checkbox === "checkbox"
        ? await field.isChecked()
        : await field.inputValue();

    await expect(cancel).toBeDisabled();
    if (checkbox === "checkbox") await field.setChecked(!saved);
    else await field.fill(`${saved} Cancel contract edit`);
    await expect(cancel).toBeEnabled();
    await expect(save).toBeEnabled();

    await cancel.click();
    if (checkbox === "checkbox")
      await expect(field).toBeChecked({ checked: saved as boolean });
    else await expect(field).toHaveValue(saved as string);
    await expect(cancel).toBeDisabled();
    await expect(save).toBeDisabled();
  });
}

test("Cancel restores Shared, JA, and EN changes together", async ({
  page,
}) => {
  await openWorkspace(page, "artists");
  const fields = [
    page.locator('input[name="name"]'),
    page.locator('textarea[name="biography"]'),
    page.locator('textarea[name="en.biography"]'),
  ];
  const saved = await Promise.all(fields.map((field) => field.inputValue()));

  for (let index = 0; index < fields.length; index += 1)
    await fields[index].fill(`${saved[index]} changed`);
  await page.locator("[data-cancel-artists]").click();

  for (let index = 0; index < fields.length; index += 1)
    await expect(fields[index]).toHaveValue(saved[index]);
});

test("About Cancel keeps the restored image select and thumbnail in sync", async ({
  page,
}) => {
  await openWorkspace(page, "about");
  const slot = page.locator('[data-about-image-slot="hero"]');
  const select = slot.locator("[data-about-image-select]");
  const thumbnail = slot.locator("[data-about-thumbnail]");
  const saved = await select.inputValue();
  const alternative = await select
    .locator("option")
    .evaluateAll(
      (options, current) =>
        options
          .map((option) => option.getAttribute("value"))
          .find((value) => value && value !== current),
      saved,
    );
  expect(alternative).toBeTruthy();

  await select.selectOption(alternative!);
  await expect(thumbnail).toHaveAttribute("src", alternative!);
  await page.locator("[data-cancel-about]").click();
  await expect(select).toHaveValue(saved);
  await expect(thumbnail).toHaveAttribute("src", saved);
});

test("a successful Save becomes the new Cancel baseline", async ({ page }) => {
  await openWorkspace(page, "news");
  const field = page.locator('input[name="shared.show_on_home"]');
  const afterSave = !(await field.isChecked());
  await page.route("**/editor/api/news/*", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { draft: unknown };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: body.draft }),
    });
  });
  await field.setChecked(afterSave);
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/editor/api/news/") &&
      candidate.request().method() === "POST",
  );
  await page.locator("[data-save-news]").click();
  expect((await response).ok()).toBe(true);
  await expect(page.locator("[data-cancel-news]")).toBeDisabled();

  await field.setChecked(!afterSave);
  await page.locator("[data-cancel-news]").click();
  await expect(field).toBeChecked({ checked: afterSave });
});

test("a failed Save does not replace the Cancel baseline", async ({ page }) => {
  await openWorkspace(page, "home");
  const field = page.locator('textarea[name="ja_about_intro"]');
  const saved = await field.inputValue();
  await page.route("**/editor/api/home", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Intentional Save failure" }),
    }),
  );
  await field.fill(`${saved} failed save edit`);
  await page.locator("[data-save-home]").click();
  await expect(page.locator("[data-cancel-home]")).toBeEnabled();
  await page.locator("[data-cancel-home]").click();
  await expect(field).toHaveValue(saved);
});
