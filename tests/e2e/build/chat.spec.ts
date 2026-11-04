import { expect, test } from "@playwright/test";
import { signIn } from "../helpers";
import { OWNER } from "../users";

test.describe("build chat", () => {
  test("opening a session connects, replays the transcript and accepts a message", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const response = await page.request.post("/api/arch/sessions", { data: {} });
    expect(response.ok()).toBeTruthy();
    await page.goto("/conversations");
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText("What would you like to change?")).toBeVisible();
    const composer = page.getByPlaceholder("Describe the change you want");
    await expect(composer).toBeEnabled();
    await composer.fill("Add a shopping list");
    await composer.press("Enter");
    // The message comes back from the session as the first user frame.
    const chat = page.locator(".mantine-Drawer-body");
    await expect(chat.getByText("Add a shopping list", { exact: true })).toBeVisible();
    // A reload replays it from the transcript.
    await page.reload();
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(chat.getByText("Add a shopping list", { exact: true })).toBeVisible();
  });
});
