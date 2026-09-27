import { expect, test } from "@playwright/test";

const BASE = process.env.WORLDFORGE_URL ?? "http://localhost:4020";

test("place tokens, move through a diamond, block spaces and reopen the battlefield", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(BASE);
  await page.getByLabel("Board layout", {exact: false}).selectOption("square-diamond");
  await page.getByRole("button", {name: /Create world & play/}).click();
  await page.getByRole("button", {name: "Open battlefield", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Battlefield sandbox"})).toBeVisible();

  await page.getByRole("button", {name: "Space 1,1 · 1 steps", exact: true}).click();
  await expect(page.locator(".battle-route")).toContainText("1 steps / 5 ft");
  await page.getByRole("button", {name: "Move to destination", exact: true}).click();
  await expect(page.getByRole("button", {name: /Wren · character · 1,1/})).toBeVisible();
  await expect(page.getByText("5 / 6 steps remaining", {exact: true})).toBeVisible();

  await page.getByRole("button", {name: "Space 2,2 · 1 steps", exact: true}).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", {name: "Move to destination", exact: true}).click();
  await expect(page.getByRole("button", {name: /Wren · character · 2,2/})).toBeVisible();
  await expect(page.getByText("4 / 6 steps remaining", {exact: true})).toBeVisible();

  await page.getByRole("button", {name: "Arrange", exact: true}).click();
  await page.getByRole("button", {name: "Place token", exact: true}).click();
  await page.getByLabel("Token name").fill("Goblin");
  await page.getByRole("button", {name: /^Space 4,0/}).click();
  await expect(page.getByRole("button", {name: /Goblin · enemy · 4,0/})).toBeVisible();
  await page.getByRole("combobox", {name: "Token kind", exact: true}).selectOption("object");
  await page.getByLabel("Token name").fill("Crate");
  await page.getByRole("button", {name: /^Space -2,0/}).click();
  await expect(page.getByRole("button", {name: /Crate · object · -2,0/})).toBeVisible();

  await page.getByRole("button", {name: "Obstacles", exact: true}).click();
  await page.getByRole("button", {name: /^Space 0,2/}).click();
  await expect(page.getByRole("button", {name: "Space 0,2 · obstacle", exact: true})).toBeVisible();
  await page.getByRole("button", {name: /Wren · character · 2,2/}).click();
  await page.getByRole("button", {name: "Space 0,2 · obstacle", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("blocked");
  await expect(page.getByRole("button", {name: "Move to destination", exact: true})).toBeDisabled();

  await page.getByRole("button", {name: "Return to world", exact: true}).click();
  await expect(page.getByText("World tick 0", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Open battlefield", exact: true}).click();
  await expect(page.getByRole("button", {name: /Wren · character · 2,2/})).toBeVisible();
  await expect(page.getByRole("button", {name: /Goblin · enemy · 4,0/})).toBeVisible();
  await expect(page.getByRole("button", {name: "Space 0,2 · obstacle", exact: true})).toBeVisible();
  await expect(page.getByText("4 / 6 steps remaining", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Reset all movement", exact: true}).click();
  await expect(page.getByText("6 / 6 steps remaining", {exact: true})).toBeVisible();

  await page.getByRole("button", {name: "Arrange", exact: true}).click();
  await page.getByLabel("Feet per movement step").fill("10");
  await page.getByRole("button", {name: "Apply scale", exact: true}).click();
  await expect(page.getByText(/10 ft per step/)).toBeVisible();
  await page.getByRole("button", {name: "Run", exact: true}).click();
  await page.getByRole("button", {name: /^Space 4,4/}).click();
  await expect(page.locator(".battle-route")).toContainText("2 steps / 20 ft");
  await page.screenshot({path: "/tmp/worldforge-battlefield.png", fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.getByRole("button", {name: "Return to world", exact: true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("hex worlds retain a usable tactical board", async ({page}) => {
  await page.goto(BASE);
  await page.getByLabel("Board layout", {exact: false}).selectOption("hex");
  await page.getByRole("button", {name: /Create world & play/}).click();
  await page.getByRole("button", {name: "Open battlefield", exact: true}).click();
  await expect(page.getByRole("button", {name: / · 1 steps$/})).toHaveCount(6);
  await page.getByRole("button", {name: "Space 1,0 · 1 steps", exact: true}).click();
  await page.getByRole("button", {name: "Move to destination", exact: true}).click();
  await expect(page.getByRole("button", {name: /Wren · character · 1,0/})).toBeVisible();
});
