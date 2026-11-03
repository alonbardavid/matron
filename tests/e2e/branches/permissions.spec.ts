import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

// The branch switcher is a combobox or a button named "Branch"; accept either.
function branchSwitcher(page: Page) {
  return page
    .getByRole("combobox", { name: "Branch" })
    .or(page.getByRole("button", { name: "Branch" }));
}

test.describe("branch permissions", () => {
  test("a member sees neither the branch switcher nor the Build button", async ({
    page,
  }) => {
    await signIn(page, MEMBER);
    await expect(page.getByRole("button", { name: "Build" })).toHaveCount(0);
    await expect(branchSwitcher(page)).toHaveCount(0);
  });

  test("the owner sees both", async ({ page }) => {
    await signIn(page, OWNER);
    await expect(page.getByRole("button", { name: "Build" })).toBeVisible();
    await expect(branchSwitcher(page)).toBeVisible();
  });
});
