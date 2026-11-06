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
});
