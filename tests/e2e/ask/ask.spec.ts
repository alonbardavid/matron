import { expect, test } from "@playwright/test";
import { signIn } from "../helpers";
import { OWNER } from "../users";

test.describe("ask", () => {
  test("a conversation belongs to the branch it was started on; Ask starts a new one", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const response = await page.request.post("/api/app/conversations", { data: {} });
    expect(response.ok()).toBeTruthy();
    const created = (await response.json()) as { id: string; branch: string };
    expect(created.branch).toBe("main");
    // The Ask button opens an empty panel, never the last conversation.
    await page.getByRole("button", { name: "Ask" }).click();
    const panel = page.locator(".mantine-Drawer-body");
    await expect(panel.getByText("Ask anything about the household")).toBeVisible();
    await page.keyboard.press("Escape");
    // The Conversations page offers to open a conversation started here.
    await page.goto("/conversations");
    await expect(page.getByRole("button", { name: "Open" })).toBeEnabled();
    // The socket is refused for a conversation from another branch.
    const upgrade = await page.request.get(
      `/api/app/ask/${created.id}/ws?branch=BR_other`,
      {
        headers: { upgrade: "websocket" },
        maxRedirects: 0,
      },
    );
    expect([403, 404]).toContain(upgrade.status());
    // Archived, so other tests find no open conversation of the assistant.
    const archived = await page.request.post(
      `/api/app/conversations/${created.id}/archive`,
    );
    expect(archived.ok()).toBeTruthy();
  });

  test("a file can go with a message, and be taken off before it is sent", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    await page.getByRole("button", { name: "Ask" }).click();
    const panel = page.locator(".mantine-Drawer-body");
    await panel.locator('input[type="file"]').setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("milk 2.50\nbread 3.10\n"),
    });
    await expect(panel.getByText("receipt.txt")).toBeVisible();
    // A file alone is enough to send.
    await expect(panel.getByRole("button", { name: "Send" })).toBeEnabled();
    await page.getByRole("button", { name: "Remove receipt.txt" }).click();
    await expect(panel.getByText("receipt.txt")).toBeHidden();
    await expect(panel.getByRole("button", { name: "Send" })).toBeDisabled();
    // Anything but a picture, a PDF or a text file is refused.
    await panel.locator('input[type="file"]').setInputFiles({
      name: "notes.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("not really a document"),
    });
    await expect(page.getByText("pictures, PDFs and text files only")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
