import { expect, type Page } from "@playwright/test";
import type { SeedUser } from "../seed-sql";

/** Signs in through the UI and waits for the todo list to show. */
export async function signIn(page: Page, user: SeedUser): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(todoInput(page)).toBeVisible();
}

export function todoInput(page: Page) {
  return page.getByPlaceholder("Add a todo");
}

export async function addTodo(page: Page, text: string): Promise<void> {
  await todoInput(page).fill(text);
  await todoInput(page).press("Enter");
  await expect(page.getByRole("checkbox", { name: text })).toBeVisible();
}
