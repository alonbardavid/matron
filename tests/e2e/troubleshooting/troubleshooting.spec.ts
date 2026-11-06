import { expect, test } from "@playwright/test";
import { executeSql } from "../../d1";
import { mergedBranchSql } from "../../seed-sql";
import { navLink, signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

test.describe("troubleshooting", () => {
  test("the owner sees both sections, each saying the deployment holds no API token", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    await navLink(page, "Troubleshooting").click();
    await expect(page.getByRole("heading", { name: "Troubleshooting" })).toBeVisible();
    for (const tab of ["Databases", "Containers"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByText("No API token")).toBeVisible();
    }
    // The view is in the URL: the tab survives a reload and a bookmark.
    await expect(page).toHaveURL(/[?&]tab=containers/);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Containers" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goto("/troubleshooting?tab=containers&stopped=1");
    await expect(page.getByLabel("Show stopped")).toBeChecked();
  });

  test("merged branches are listed, and a revert the database cannot reach fails visibly", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const recent = `pantry-${suffix}`;
    const old = `ancient-${suffix}`;
    executeSql([
      mergedBranchSql({ ownerEmail: OWNER.email, name: recent, createdDaysAgo: 2 }),
      mergedBranchSql({ ownerEmail: OWNER.email, name: old, createdDaysAgo: 40 }),
    ]);
    await signIn(page, OWNER);
    await page.goto("/troubleshooting?tab=merges");
    const recentRow = page.getByRole("row").filter({ hasText: recent });
    const oldRow = page.getByRole("row").filter({ hasText: old });
    // Time Travel keeps thirty days: the older branch cannot be reverted.
    await expect(oldRow.getByRole("button", { name: "Revert" })).toBeDisabled();
    await recentRow.getByRole("button", { name: "Revert" }).click();
    const confirm = page.locator(".mantine-Popover-dropdown");
    await expect(confirm).toContainText(`Revert ${recent}?`);
    await expect(confirm).toContainText("Users, sign-ins, build sessions");
    await confirm.getByRole("button", { name: "Revert" }).click();
    // Locally there is no API token: the restore point check refuses before anything changes.
    await expect(page.getByText(/no Cloudflare API token/).first()).toBeVisible();
    await expect(recentRow.getByText("failed")).toBeVisible();
  });

  test("a member has no troubleshooting page", async ({ page }) => {
    await signIn(page, MEMBER);
    await expect(navLink(page, "Troubleshooting")).toHaveCount(0);
    await page.goto("/troubleshooting");
    await expect(page.getByRole("heading", { name: "Calendar", level: 2 })).toBeVisible();
    const answer = await page.request.get("/api/arch/troubleshooting/databases");
    expect(answer.status()).toBe(403);
    const revert = await page.request.post("/api/arch/troubleshooting/merges/any/revert");
    expect(revert.status()).toBe(403);
  });
});
