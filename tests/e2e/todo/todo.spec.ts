import { expect, test } from "@playwright/test";
import { addTodo, signIn } from "../helpers";
import { OWNER } from "../users";

test.describe("todo list", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, OWNER);
  });

  test("add, check, edit and delete an item", async ({ page }) => {
    const text = `Buy milk ${Date.now()}`;
    await addTodo(page, text);
    const item = page.getByRole("checkbox", { name: text });
    await expect(item).not.toBeChecked();

    await item.check();
    await expect(item).toBeChecked();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: text })).toBeChecked();

    const edited = `${text} (oat)`;
    await page.getByRole("button", { name: `Edit ${text}` }).click();
    const editor = page.getByRole("textbox", { name: `Edit ${text}` });
    await editor.fill(edited);
    await editor.press("Enter");
    await expect(page.getByRole("checkbox", { name: edited })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: text, exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: `Delete ${edited}` }).click();
    await expect(page.getByRole("checkbox", { name: edited })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: edited })).toHaveCount(0);
  });

  test("items persist across a reload", async ({ page }) => {
    const text = `Water plants ${Date.now()}`;
    await addTodo(page, text);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: text })).toBeVisible();
    await page.getByRole("button", { name: `Delete ${text}` }).click();
    await expect(page.getByRole("checkbox", { name: text })).toHaveCount(0);
  });
});
