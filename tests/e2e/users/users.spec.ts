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

      // No admin path to the owner role: not granting it, not taking over an owner.
      const post = (path: string, data: object) =>
        adminPage.request.post(`/api/arch/auth/admin/${path}`, {
          headers: { origin },
          data,
        });
      const listed = await adminPage.request.get(
        "/api/arch/auth/admin/list-users?limit=200",
      );
      const { users } = (await listed.json()) as {
        users: { id: string; email: string }[];
      };
      const ownerId = users.find((u) => u.email === OWNER.email)!.id;
      const newOwner = {
        email: "otto@example.com",
        password: "otto-password-123",
        name: "Otto Owner",
      };
      expect((await post("create-user", { ...newOwner, role: "owner" })).status()).toBe(
        403,
      );
      expect(
        (await post("create-user", { ...newOwner, data: { role: "owner" } })).status(),
      ).toBe(403);
      expect((await post("set-role", { userId: user.id, role: "owner" })).status()).toBe(
        403,
      );
      expect(
        (
          await post("update-user", { userId: user.id, data: { role: "owner" } })
        ).status(),
      ).toBe(403);
      expect((await post("set-role", { userId: ownerId, role: "member" })).status()).toBe(
        403,
      );
      expect(
        (
          await post("set-user-password", {
            userId: ownerId,
            newPassword: "taken-over-123",
          })
        ).status(),
      ).toBe(403);
      expect((await post("remove-user", { userId: ownerId })).status()).toBe(403);

      // Members and admins are still the admin's to manage.
      const member = await post("create-user", {
        email: "mia@example.com",
        password: "mia-password-123",
        name: "Mia Member",
        role: "member",
      });
      expect(member.ok()).toBe(true);
      const { user: mia } = (await member.json()) as { user: { id: string } };
      expect((await post("set-role", { userId: mia.id, role: "admin" })).ok()).toBe(true);
      expect((await post("remove-user", { userId: mia.id })).ok()).toBe(true);

      // The screen offers none of it: no Owner to pick, the owner's row is fixed.
      await navLink(adminPage, "Users").click();
      await expect(
        adminPage.getByRole("combobox", { name: `Role of ${OWNER.name}` }),
      ).toBeDisabled();
      await expect(
        adminPage
          .getByRole("row", { name: new RegExp(OWNER.name) })
          .getByRole("button", { name: "Remove" }),
      ).toHaveCount(0);
      await adminPage.getByRole("button", { name: "Add user" }).click();
      await adminPage.getByRole("dialog").getByRole("combobox", { name: "Role" }).click();
      await expect(adminPage.getByRole("option", { name: "Admin" })).toBeVisible();
      await expect(adminPage.getByRole("option", { name: "Owner" })).toHaveCount(0);
    } finally {
      await context.close();
      await page.request.post("/api/arch/auth/admin/remove-user", {
        headers: { origin },
        data: { userId: user.id },
      });
    }
  });
});
