import { expect, test } from "@playwright/test";
import { signIn, todoInput } from "../helpers";
import { OWNER } from "../users";

test.describe("sign in", () => {
  test("a visitor sees the sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(todoInput(page)).toHaveCount(0);
  });

  test("a wrong password shows an error and stays signed out", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(todoInput(page)).toHaveCount(0);
  });

  test("signing in lands on the todo list and survives a reload", async ({ page }) => {
    await signIn(page, OWNER);
    await page.reload();
    await expect(todoInput(page)).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
  });

  test("sign out returns to the sign-in screen", async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
