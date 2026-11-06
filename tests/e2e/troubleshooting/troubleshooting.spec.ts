import { expect, test } from "@playwright/test";
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

  test("the owner sees every branch and can check origin for updates", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    await page.goto("/troubleshooting?tab=branches");
    await expect(page.getByRole("tab", { name: "Branches" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("columnheader", { name: "Created by" })).toBeVisible();
    await expect(page.getByText("No open branches.")).toBeVisible();
    // The switch follows the URL, so it is clicked and then read back.
    await page.getByLabel("Show archived").click();
    await expect(page).toHaveURL(/[?&]archived=1/);
    await expect(page.getByLabel("Show archived")).toBeChecked();
    await expect(page.getByText("No branches yet.")).toBeVisible();
    // Locally there is no code repository to compare upstream with.
    await page.getByRole("button", { name: "Check origin updates" }).click();
    await expect(page.getByText("Could not check origin")).toBeVisible();
    await expect(page.getByText("The code repository is not available")).toBeVisible();
  });

  test("a member has no troubleshooting page", async ({ page }) => {
    await signIn(page, MEMBER);
    await expect(navLink(page, "Troubleshooting")).toHaveCount(0);
    await page.goto("/troubleshooting");
    await expect(page.getByRole("heading", { name: "Calendar", level: 2 })).toBeVisible();
    const answer = await page.request.get("/api/arch/troubleshooting/databases");
    expect(answer.status()).toBe(403);
    const branches = await page.request.get("/api/arch/troubleshooting/branches");
    expect(branches.status()).toBe(403);
    const origin = await page.request.post("/api/arch/troubleshooting/origin/check");
    expect(origin.status()).toBe(403);
  });
});
