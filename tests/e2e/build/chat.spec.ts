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
    // The chat starts from what the session holds, asked for before the socket connects:
    // a socket that connects while the planner answers is sent only the answer.
    const { id } = (await response.json()) as { id: string };
    const held = await page.request.get(`/api/arch/sessions/${id}/ws/get-messages`);
    expect(held.ok()).toBeTruthy();
    const messages = (await held.json()) as { metadata?: { createdAt?: number } }[];
    expect(JSON.stringify(messages)).toContain("Add a shopping list");
    // It carries when it was said, which the chat shows beside it.
    expect(messages[0]?.metadata?.createdAt).toBeGreaterThan(0);
    await expect(chat.getByText("just now")).toBeVisible();
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

  test("the chat panel widens by dragging its edge, and stays so", async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole("button", { name: "Build" }).click();
    const panel = page.locator(".mantine-Drawer-content");
    await expect(panel).toBeVisible();
    const widthOf = async () => Math.round((await panel.boundingBox())!.width);
    await expect.poll(widthOf).toBe(440);
    // It slides in: the edge is where it will stay once the panel reaches the window's.
    const viewport = page.viewportSize()!;
    const rightOf = async () => {
      const box = (await panel.boundingBox())!;
      return Math.round(box.x + box.width);
    };
    await expect.poll(rightOf).toBe(viewport.width);
    const edge = page.getByRole("separator", { name: "Panel width" });
    const at = (await edge.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.width - 700, at.y + at.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(widthOf).toBe(700);
    // The width is this browser's: it is there again after a reload.
    await page.reload();
    await page.getByRole("button", { name: "Build" }).click();
    await expect.poll(widthOf).toBe(700);
    // A double click gives the usual width back.
    await edge.dblclick();
    await expect.poll(widthOf).toBe(440);
  });
});
