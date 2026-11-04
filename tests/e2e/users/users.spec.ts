import { expect, test } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { OWNER } from "../users";

test.describe("users", () => {
  test("the owner adds a user, changes the role and removes them", async ({ page }) => {
    await signIn(page, OWNER);
    await navLink(page, "Users").click();
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    await page.getByRole("button", { name: "Add user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Nina New");
    await dialog.getByLabel("Email").fill("nina@example.com");
    await dialog.getByLabel("Password", { exact: true }).fill("nina-password-123");
    await dialog.getByRole("button", { name: "Add user" }).click();
    await expect(page.getByText("nina@example.com")).toBeVisible();

    const role = page.getByRole("combobox", { name: "Role of Nina New" });
    await role.click();
    await page.getByRole("option", { name: "Admin" }).click();
    await expect(role).toHaveValue("Admin");

    const row = page.getByRole("row", { name: /Nina New/ });
    await row.getByRole("button", { name: "Remove" }).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Remove Nina New from the household?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByText("nina@example.com")).toHaveCount(0);
  });
});
