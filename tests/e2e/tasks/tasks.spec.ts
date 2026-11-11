import { expect, test } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

test.describe("tasks", () => {
  test("add, complete, edit and remove a task", async ({ page }) => {
    await signIn(page, OWNER);
    await navLink(page, "Tasks").click();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog");
    // The title has focus, and Tab walks on to the next field.
    await expect(dialog.getByLabel("Title")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("Description")).toBeFocused();
    await dialog.getByLabel("Title").fill("Buy milk");
    await dialog.getByRole("button", { name: "Add task" }).click();
    const checkbox = page.getByRole("checkbox", { name: "Buy milk" });
    await expect(checkbox).toBeVisible();

    await checkbox.click();
    // Saved as done, it moves to the completed section, which a switch hides.
    const completed = page.getByRole("region", { name: "Completed" });
    await expect(completed.getByRole("checkbox", { name: "Buy milk" })).toBeChecked();
    const hide = page.getByRole("switch", { name: "Hide completed" });
    await hide.click();
    await expect(page.getByRole("checkbox", { name: "Buy milk" })).toHaveCount(0);
    await hide.click();
    await expect(completed.getByRole("checkbox", { name: "Buy milk" })).toBeVisible();

    await page.getByRole("button", { name: "Buy milk" }).click();
    await dialog.getByLabel("Title").fill("Buy oat milk");
    // Enter in a field submits the form.
    await dialog.getByLabel("Title").press("Enter");
    await expect(page.getByRole("checkbox", { name: "Buy oat milk" })).toBeVisible();

    await page.getByRole("button", { name: "Buy oat milk" }).click();
    await dialog.getByRole("button", { name: "Remove" }).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Remove this task?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByRole("checkbox", { name: "Buy oat milk" })).toHaveCount(0);
  });

  test("a task is seen only by its creator and the people it is shared with", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const created = await page.request.post("/api/app/tasks", {
      data: { title: "Private task" },
    });
    expect(created.ok()).toBeTruthy();
    const member = await browser.newContext();
    const memberPage = await member.newPage();
    await signIn(memberPage, MEMBER);
    const list = await memberPage.request.get("/api/app/tasks");
    const tasks = (await list.json()) as { title: string }[];
    expect(tasks.map((t) => t.title)).not.toContain("Private task");
    await member.close();
  });
});
