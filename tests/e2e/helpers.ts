import { expect, type Page } from "@playwright/test";
import type { SeedUser } from "../seed-sql";

/** Signs in through the UI and waits for the calendar, the first page. */
export async function signIn(page: Page, user: SeedUser): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(calendarHeading(page)).toBeVisible();
}

export function calendarHeading(page: Page) {
  return page.getByRole("heading", { name: "Calendar", level: 2 });
}

/** The navigation link, in the navbar on wide screens. */
export function navLink(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name, exact: true });
}
