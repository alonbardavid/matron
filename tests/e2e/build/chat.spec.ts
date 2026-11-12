import { expect, test } from "@playwright/test";
import { signIn } from "../helpers";
import { OWNER } from "../users";

test.describe("build chat", () => {
  test("opening a session accepts a message and shows it again after a reload", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const response = await page.request.post("/api/arch/sessions", { data: {} });
    expect(response.ok()).toBeTruthy();
    await page.goto("/builds");
    await page.getByRole("button", { name: "Chat" }).click();
    await expect(page.getByText("What would you like to change?")).toBeVisible();
    const composer = page.getByPlaceholder("Describe the change you want");
    await expect(composer).toBeEnabled();
    await composer.fill("Add a shopping list");
    await composer.press("Enter");
    // The message is kept by the session and shown as the member's.
    const chat = page.locator(".mantine-Drawer-body");
    await expect(chat.getByText("Add a shopping list", { exact: true })).toBeVisible();
    // Without a gateway token the planner cannot answer; the session has the message by then.
    await expect(chat.getByText("The planner could not answer")).toBeVisible();
    // A reload replays it from the session.
    await page.reload();
    await page.getByRole("button", { name: "Chat" }).click();
    await expect(chat.getByText("Add a shopping list", { exact: true })).toBeVisible();
  });

  test("a file can go with a message to the build chat", async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole("button", { name: "Build" }).click();
    const panel = page.locator(".mantine-Drawer-body");
    await panel.locator('input[type="file"]').setInputFiles({
      name: "sketch.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("a list with checkboxes\n"),
    });
    await expect(panel.getByText("sketch.txt")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Send" })).toBeEnabled();
    await page.getByRole("button", { name: "Remove sketch.txt" }).click();
    await expect(panel.getByText("sketch.txt")).toBeHidden();
    await expect(panel.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
