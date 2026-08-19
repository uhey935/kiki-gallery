import { expect, test, type Request } from "@playwright/test";

test.use({ channel: "chrome", viewport: { width: 390, height: 844 } });

test("mobile menu waits for close transition and navigates once", async ({
  page,
  context,
}) => {
  const routes = [
    ["Artists", "/artists/"],
    ["Exhibitions", "/exhibitions/"],
    ["About", "/about/"],
    ["KiKi Gallery home", "/"],
  ] as const;

  await page.goto("/");

  const initialMenuButton = page.getByRole("button", { name: "Open menu" });
  await initialMenuButton.click();
  await expect(initialMenuButton).toHaveAttribute("aria-expanded", "true");
  const modifiedPagePromise = context.waitForEvent("page");
  await page
    .getByRole("link", { name: "Artists", exact: true })
    .click({ modifiers: ["Meta"] });
  const modifiedPage = await modifiedPagePromise;
  await modifiedPage.waitForLoadState();
  await expect(modifiedPage).toHaveURL(/\/artists\/$/);
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await modifiedPage.close();
  await initialMenuButton.click();
  await expect(initialMenuButton).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".site-header")).not.toHaveClass(/is-closing/);

  for (const [name, pathname] of routes) {
    const menuButton = page.getByRole("button", { name: "Open menu" });
    await menuButton.click();
    await expect(page.locator(".site-header")).toHaveClass(/is-open/);
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");

    const navigationRequests: string[] = [];
    const recordNavigation = (request: Request) => {
      if (request.isNavigationRequest()) navigationRequests.push(request.url());
    };
    page.on("request", recordNavigation);

    const startedAt = Date.now();
    const destination = page.getByRole("link", { name, exact: true });
    const repeatedClickTarget = page.locator(
      `[data-menu-link][href="${pathname}"]`,
    );
    await destination.click();
    await repeatedClickTarget.click({ force: true });
    await page.waitForURL((url) => url.pathname === pathname);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(450);
    expect(navigationRequests).toHaveLength(1);
    page.off("request", recordNavigation);
  }

  await page.goBack();
  await expect(page).toHaveURL(/\/about\/$/);
  await page.goForward();
  await expect(page).toHaveURL((url) => url.pathname === "/");
});

test.describe("desktop header", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("logo and locale links retain native navigation", async ({ page }) => {
    await page.goto("/artists/");
    await page.getByRole("link", { name: "KiKi Gallery home" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/");

    await page.goto("/artists/");
    await page.getByRole("link", { name: "EN", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/artists\/$/);
  });
});
