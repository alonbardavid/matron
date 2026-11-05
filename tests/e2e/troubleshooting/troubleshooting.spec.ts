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

  test("a member has no troubleshooting page", async ({ page }) => {
    await signIn(page, MEMBER);
    await expect(navLink(page, "Troubleshooting")).toHaveCount(0);
    await page.goto("/troubleshooting");
    await expect(page.getByRole("heading", { name: "Calendar", level: 2 })).toBeVisible();
    const answer = await page.request.get("/api/arch/troubleshooting/databases");
    expect(answer.status()).toBe(403);
  });
});
