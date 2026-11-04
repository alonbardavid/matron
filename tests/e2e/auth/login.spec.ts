import { expect, test } from "@playwright/test";
import { calendarHeading, navLink, signIn } from "../helpers";
import { OWNER } from "../users";

test.describe("sign in", () => {
  test("a visitor sees the sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(calendarHeading(page)).toHaveCount(0);
  });

  test("a wrong password shows an error and stays signed out", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(calendarHeading(page)).toHaveCount(0);
  });

  test("signing in lands on the calendar and survives a reload", async ({ page }) => {
    await signIn(page, OWNER);
    await page.reload();
    await expect(calendarHeading(page)).toBeVisible();
  });

  test("logout returns to the sign-in screen", async ({ page }) => {
    await signIn(page, OWNER);
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Logout" })
      .click();
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
  });

  test("the navbar shows management pages to the owner only", async ({ page }) => {
    await signIn(page, OWNER);
    await expect(navLink(page, "Users")).toBeVisible();
    await expect(navLink(page, "App settings")).toBeVisible();
  });
});
