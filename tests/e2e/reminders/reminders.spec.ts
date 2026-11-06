import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { OWNER } from "../users";

const backendDir = resolve(import.meta.dirname, "../../../apps/backend");
const MINUTE = 60_000;

/** Runs the Worker's hourly cron once, as Cloudflare would. */
async function runReminderSweep(page: Page): Promise<void> {
  const response = await page.request.get(
    "http://localhost:8301/cdn-cgi/handler/scheduled?cron=0+*+*+*+*",
  );
  expect(response.ok()).toBe(true);
}

/** The reminders the sweeps have claimed, read from the test database. */
function remindersSent(): { subject: string; user_id: string }[] {
  const result = spawnSync(
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
      "--json",
      "--command",
      "SELECT subject, user_id FROM reminder ORDER BY subject",
    ],
    { cwd: backendDir, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout)[0].results;
}

/** A fixed-offset zone whose wall clock reads 23:xx now, so its day ends within the hour. */
function zoneNearMidnight(now: Date): string {
  const offset = ((23 - now.getUTCHours() + 36) % 24) - 12; // within -12..11
  // Etc/GMT names have the sign reversed: Etc/GMT-3 is three hours ahead of UTC.
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

function dayIn(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

test.describe("reminders", () => {
  test("Matron installs as an app with a service worker", async ({ page }) => {
    const manifest = await page.request.get("/site.webmanifest");
    expect(await manifest.json()).toMatchObject({
      name: "Matron",
      start_url: "/",
      display: "standalone",
    });
    await page.goto("/");
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return new URL(registration.scope).pathname;
    });
    expect(scope).toBe("/");
  });

  test("settings offer reminders on this device", async ({ page }) => {
    await signIn(page, OWNER);
    await navLink(page, "Settings").click();
    const card = page.getByRole("group", { name: "Reminders" });
    await expect(
      card.getByRole("switch", { name: "Reminders on this device" }),
    ).toBeVisible();
  });

  test("an attendee and an assignee are reminded once, ahead of time", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const now = new Date();
    const timeZone = zoneNearMidnight(now);
    const subscribed = await page.request.post(
      "/api/app/notifications/push/subscriptions",
      {
        data: {
          // Nothing answers here: the sweep's push fails, and its claim stands all the same.
          endpoint: `https://push.invalid/${crypto.randomUUID()}`,
          keys: {
            p256dh:
              "BLV4n6cvfBY3bbnO8I2Jl6ALrHt3PRhzTEni4nxqkGh_ZnpnNtL_913GT-jLiJrclp_IAdDqbiFiIxa5ngHmAsk",
            auth: "c2VjcmV0LWF1dGgta2V5IQ",
          },
          timeZone,
        },
      },
    );
    expect(subscribed.ok()).toBe(true);

    const event = async (title: string, startsIn: number) => {
      const startAt = now.getTime() + startsIn;
      const response = await page.request.post("/api/app/calendar/events", {
        data: { title, allDay: false, startAt, endAt: startAt + 30 * MINUTE, timeZone },
      });
      expect(response.ok()).toBe(true);
      return (await response.json()) as { id: string; startAt: number };
    };
    const soon = await event("Dentist", 45 * MINUTE);
    const later = await event("Dinner party", 4 * 60 * MINUTE);

    const task = async (title: string, dueDate: string) => {
      const response = await page.request.post("/api/app/tasks", {
        data: { title, dueDate },
      });
      expect(response.ok()).toBe(true);
      return (await response.json()) as { id: string };
    };
    const dueToday = dayIn(timeZone, now);
    const tonight = await task("Take the bins out", dueToday);
    const nextWeek = await task(
      "Book flights",
      dayIn(timeZone, new Date(now.getTime() + 2 * 86_400_000)),
    );

    await runReminderSweep(page);
    await runReminderSweep(page);

    // Other specs' events may be reminded too; these are the ones this test made.
    const subjects = remindersSent().map((r) => r.subject);
    expect(subjects).toContain(`event:${soon.id}:${soon.startAt}`);
    expect(subjects).toContain(`task:${tonight.id}:${dueToday}`);
    expect(subjects.filter((s) => s.includes(soon.id))).toHaveLength(1);
    expect(
      subjects.filter((s) => s.includes(later.id) || s.includes(nextWeek.id)),
    ).toEqual([]);
  });
});
