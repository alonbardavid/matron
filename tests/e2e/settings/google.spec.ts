import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

// The made-up app local dev runs with (apps/backend/wrangler.jsonc).
const CLIENT_ID = "1234-local.apps.googleusercontent.com";

test.describe("google calendar", () => {
  test("the household's Google app is the Worker's; members connect through it", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    await navLink(page, "App settings").click();
    // Secrets are write-only: only the first few characters of each come back.
    await expect(page.getByLabel("Client ID")).toHaveValue("1234-local****");
    await expect(page.getByLabel("Client secret")).toHaveValue("local-dev-****");
    const secrets = await (await page.request.get("/api/arch/settings/secrets")).json();
    expect(secrets).toEqual({
      changeable: false,
      secrets: {
        GOOGLE_CLIENT_ID: "1234-local****",
        GOOGLE_CLIENT_SECRET: "local-dev-****",
      },
    });

    // They are secrets of the Worker, set through Cloudflare's API, which a
    // deployment without a token cannot reach: nothing changes from here.
    await expect(page.getByText("holds no Cloudflare API token")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Google app" })).toBeDisabled();
    const refused = await page.request.put("/api/arch/settings/secrets", {
      data: { GOOGLE_CLIENT_SECRET: "another" },
    });
    expect(refused.status()).toBe(503);
    // Only the household's own secrets can be named.
    const stray = await page.request.put("/api/arch/settings/secrets", {
      data: { SIGNING_KEY: "mine" },
    });
    expect(stray.status()).toBe(400);

    const member = await browser.newContext();
    const memberPage = await member.newPage();
    await signIn(memberPage, MEMBER);
    expect((await memberPage.request.get("/api/arch/settings/secrets")).status()).toBe(
      403,
    );
    const status = await (
      await memberPage.request.get("/api/app/calendar/google")
    ).json();
    expect(status).toEqual({ configured: true, canConnect: true, connection: null });

    // Connecting links the member's Google account through the auth: the
    // browser is sent to Google's consent page for the household's client,
    // asking to read calendars and for access that outlives the hour.
    const origin = new URL(memberPage.url()).origin;
    const link = await memberPage.request.post("/api/arch/auth/link-social", {
      headers: { origin },
      data: {
        provider: "google",
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        callbackURL: "/settings?google=linked",
        errorCallbackURL: "/settings?google=failed",
      },
    });
    expect(link.ok()).toBeTruthy();
    const { url } = (await link.json()) as { url: string };
    const consent = new URL(url);
    expect(consent.host).toBe("accounts.google.com");
    expect(consent.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(consent.searchParams.get("scope")).toContain("calendar.readonly");
    expect(consent.searchParams.get("access_type")).toBe("offline");
    expect(consent.searchParams.get("redirect_uri")).toMatch(
      /\/api\/arch\/auth\/callback\/google$/,
    );

    // A forged state is refused before anything reaches Google, and links nothing.
    const callback = await memberPage.request.get(
      "/api/arch/auth/callback/google?state=forged&code=x",
      { maxRedirects: 0 },
    );
    expect(callback.status()).toBe(302);
    expect(callback.headers().location).not.toContain("google=linked");
    expect(
      (await memberPage.request.post("/api/app/calendar/google/sync")).status(),
    ).toBe(404);

    // Google's notice of a changed calendar needs no sign-in, only a notice
    // the import started; any other is turned away.
    const stranger = await browser.newContext();
    const push = await stranger.request.post(
      `${origin}/api/app/public/calendar/google/push`,
      {
        headers: {
          "x-goog-channel-id": "GW_unknown",
          "x-goog-resource-id": "unknown",
          "x-goog-resource-state": "exists",
        },
      },
    );
    expect(push.status()).toBe(404);
    // A notice the import started counts, for the resource Google named with it.
    spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--local",
        "--persist-to",
        ".wrangler-test",
        "--command",
        "INSERT INTO google_calendar_watch (id, calendar_id, resource_id, expires_at) VALUES ('GW_test', 'CL_none', 'res-1', 4102444800000)",
      ],
      { cwd: resolve(import.meta.dirname, "../../../apps/backend"), encoding: "utf8" },
    );
    const notice = (resourceId: string, state: string) =>
      stranger.request.post(`${origin}/api/app/public/calendar/google/push`, {
        headers: {
          "x-goog-channel-id": "GW_test",
          "x-goog-resource-id": resourceId,
          "x-goog-resource-state": state,
        },
      });
    expect((await notice("res-1", "sync")).status()).toBe(204);
    expect((await notice("res-1", "exists")).status()).toBe(204);
    expect((await notice("res-2", "exists")).status()).toBe(404);
    // Nothing else of the application answers a stranger.
    expect(
      (await stranger.request.get(`${origin}/api/app/calendar/calendars`)).status(),
    ).toBe(401);
    await stranger.close();

    await navLink(memberPage, "Settings").click();
    await expect(
      memberPage.getByRole("button", { name: "Connect Google Calendar" }),
    ).toBeEnabled();
    await member.close();
  });
});
