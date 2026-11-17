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

  test("an admin manages users but has no app settings or troubleshooting", async ({
    page,
    browser,
  }) => {
    const admin = {
      email: "adam@example.com",
      password: "adam-password-123",
      name: "Adam Admin",
      role: "admin" as const,
    };
    await signIn(page, OWNER);
    const origin = new URL(page.url()).origin;
    const created = await page.request.post("/api/arch/auth/admin/create-user", {
      headers: { origin },
      data: admin,
    });
    expect(created.ok()).toBe(true);
    const { user } = (await created.json()) as { user: { id: string } };

    const context = await browser.newContext();
    try {
      const adminPage = await context.newPage();
      await signIn(adminPage, admin);
      await expect(navLink(adminPage, "Users")).toBeVisible();
      await expect(navLink(adminPage, "App settings")).toHaveCount(0);
      await expect(navLink(adminPage, "Troubleshooting")).toHaveCount(0);
      await adminPage.goto("/app-settings");
      await expect(
        adminPage.getByRole("heading", { name: "Calendar", level: 2 }),
      ).toBeVisible();
      const secrets = await adminPage.request.get("/api/arch/settings/secrets");
      expect(secrets.status()).toBe(403);
      const update = await adminPage.request.put("/api/arch/settings", {
        data: { askModel: "@cf/moonshotai/kimi-k2.6" },
      });
      expect(update.status()).toBe(403);
    } finally {
      await context.close();
      await page.request.post("/api/arch/auth/admin/remove-user", {
        headers: { origin },
        data: { userId: user.id },
      });
    }
  });
});
