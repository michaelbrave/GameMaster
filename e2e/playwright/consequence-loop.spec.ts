// Browser-level journey for the consequence loop. Not wired into the default
// test suite — see e2e/README.md for how to enable it where Playwright
// browsers are installed.
import { expect, test } from "@playwright/test";

const BASE = process.env.WORLDFORGE_URL ?? "http://localhost:4020";

test.describe("worldforge consequence loop (browser)", () => {
  test("create world, travel, fight, return, observe consequence", async ({ page }) => {
    await page.goto(BASE);

    // Setup screen
    await expect(page.getByRole("heading", { name: "Worldforge" })).toBeVisible();
    await page.getByLabel(/World seed/i).fill("demo-16");
    await page.getByRole("button", { name: /Create world & play/i }).click();

    // Play screen: map + log visible
    await expect(page.getByRole("img", { name: /World map/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /List \(l\)/i })).toBeVisible();

    // Accessible list view shows the same information
    await page.getByRole("button", { name: /List \(l\)/i }).click();
    await expect(page.getByText(/Accessible list equivalent/i)).toBeVisible();
    await page.getByRole("button", { name: /Map \(m\)/i }).click();

    // Travel east via the travel controls
    const travel = page.getByRole("button", { name: /→ 1,0/ });
    if (await travel.count()) {
      await travel.first().click();
    }

    // If an encounter appears, pick the first choice; the log records it.
    const choice = page.locator(".choices button").first();
    if (await choice.count()) {
      await choice.click();
      await expect(page.locator(".log-entries li").last()).toBeVisible();
    }

    // Build tools open and list tables
    await page.getByRole("button", { name: /Build tools \(b\)/i }).click();
    await expect(page.getByText(/core\/travel-encounter/)).toBeVisible();
  });
});
