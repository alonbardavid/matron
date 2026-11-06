import { expect, test } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

const CLIENT_ID = "1234-test.apps.googleusercontent.com";

test.describe("google calendar", () => {
  test("the owner sets up the Google app; members connect through it", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    await navLink(page, "App settings").click();
    await expect(page.getByLabel("Client ID")).toBeVisible();
    await page.getByLabel("Client ID").fill(CLIENT_ID);
    await page.getByLabel("Client secret").fill("test-client-secret");
    await page.getByRole("button", { name: "Save Google app" }).click();
    await expect(page.getByText("Google Calendar app saved")).toBeVisible();

    // The secret is write-only.
    const google = await (await page.request.get("/api/arch/settings/google")).json();
    expect(google).toMatchObject({ clientId: CLIENT_ID, clientSecretSet: true });
    expect(JSON.stringify(google)).not.toContain("test-client-secret");
    expect(google.redirectUri).toMatch(/\/api\/app\/calendar\/google\/callback$/);

    const member = await browser.newContext();
    const memberPage = await member.newPage();
    await signIn(memberPage, MEMBER);
    expect((await memberPage.request.get("/api/arch/settings/google")).status()).toBe(
      403,
    );
    const status = await (
      await memberPage.request.get("/api/app/calendar/google")
    ).json();
    expect(status).toEqual({ configured: true, canConnect: true, connection: null });

    // Connecting sends the browser to Google's consent page for this client.
    const connect = await memberPage.request.post("/api/app/calendar/google/connect", {
      data: {},
    });
    const { url } = (await connect.json()) as { url: string };
    const consent = new URL(url);
    expect(consent.host).toBe("accounts.google.com");
    expect(consent.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(consent.searchParams.get("scope")).toContain("calendar.readonly");

    // A forged or stale state is refused before anything reaches Google.
    const callback = await memberPage.request.get(
      "/api/app/calendar/google/callback?state=forged.state&code=x",
      { maxRedirects: 0 },
    );
    expect(callback.status()).toBe(302);
    expect(callback.headers().location).toBe("/settings?google=invalid");

    await navLink(memberPage, "Settings").click();
    await expect(
      memberPage.getByRole("button", { name: "Connect Google Calendar" }),
    ).toBeEnabled();
    await member.close();

    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Remove the Google app?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByText("Google Calendar app removed")).toBeVisible();
  });
});
