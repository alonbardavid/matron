import { expect, test } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { OWNER } from "../users";

test.describe("settings", () => {
  test("a member changes their name; the email stays", async ({ page }) => {
    await signIn(page, OWNER);
    await navLink(page, "Settings").click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeDisabled();
    await page.getByLabel("Name").fill("Olive Owner-Renamed");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Name saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Name")).toHaveValue("Olive Owner-Renamed");
    await page.getByLabel("Name").fill(OWNER.name);
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Name saved")).toBeVisible();
  });

  test("the owner picks the builder's and the assistant's models", async ({ page }) => {
    await signIn(page, OWNER);
    await navLink(page, "App settings").click();
    const builderModel = page.getByRole("combobox", { name: "Builder model" });
    await builderModel.click();
    await page.getByRole("option", { name: "claude-sonnet-5-5" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();

    const assistantModel = page.getByRole("combobox", { name: "Assistant model" });
    await assistantModel.click();
    await page.getByRole("option", { name: "claude-haiku-5-5" }).click();
    await expect(page.getByText("Settings saved").nth(1)).toBeVisible();
    // Only Anthropic's models are taken.
    const other = await page.request.put("/api/arch/settings", {
      data: { askModel: "@cf/moonshotai/kimi-k2.6" },
    });
    expect(other.status()).toBe(400);

    const settings = await page.request.get("/api/arch/settings");
    expect(await settings.json()).toEqual({
      builderModel: "claude-sonnet-5-5",
      askModel: "claude-haiku-5-5",
    });
  });
});
