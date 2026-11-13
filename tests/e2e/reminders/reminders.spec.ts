import { expect, test, type Page } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

const MINUTE = 60_000;
const SCHEDULED = "http://localhost:8301/cdn-cgi/handler/scheduled";

async function newEvent(page: Page, title: string, startsIn: number) {
  const startAt = Date.now() + startsIn;
  const response = await page.request.post("/api/app/calendar/events", {
    data: {
      title,
      allDay: false,
      startAt,
      endAt: startAt + 30 * MINUTE,
      timeZone: "UTC",
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string };
}

/** The caller's alarm on an event or a task, as the API has it. */
async function alarmOf(page: Page, path: string): Promise<number | null> {
  const response = await page.request.get(`${path}/alarm`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { minutesBefore: number | null }).minutesBefore;
}

async function setAlarm(page: Page, path: string, minutesBefore: number | null) {
  return page.request.put(`${path}/alarm`, { data: { minutesBefore } });
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

  test("the Worker runs the cron it knows and refuses any other", async ({ page }) => {
    const known = await page.request.get(`${SCHEDULED}?cron=17+3+*+*+*`);
    expect(known.ok()).toBe(true);
    const unknown = await page.request.get(`${SCHEDULED}?cron=5+4+*+*+*`);
    expect(unknown.ok()).toBe(false);
  });

  test("settings offer reminders on this device", async ({ page }) => {
    await signIn(page, OWNER);
    await navLink(page, "Settings").click();
    const card = page.getByRole("group", { name: "Reminders" });
    await expect(
      card.getByRole("switch", { name: "Reminders on this device" }),
    ).toBeVisible();
  });

  test("a member's alarm on an event rings ahead of it, once", async ({ page }) => {
    await signIn(page, OWNER);
    const subscribed = await page.request.post(
      "/api/app/notifications/push/subscriptions",
      {
        data: {
          // Nothing answers here: the ring's push fails, and the alarm is rung all the same.
          endpoint: `https://push.invalid/${crypto.randomUUID()}`,
          keys: {
            p256dh:
              "BLV4n6cvfBY3bbnO8I2Jl6ALrHt3PRhzTEni4nxqkGh_ZnpnNtL_913GT-jLiJrclp_IAdDqbiFiIxa5ngHmAsk",
            auth: "c2VjcmV0LWF1dGgta2V5IQ",
          },
          timeZone: "UTC",
        },
      },
    );
    expect(subscribed.ok()).toBe(true);
    // Five minutes before each of these is seconds from now, and an hour from now.
    const soon = await newEvent(page, "Dentist", 5 * MINUTE + 4_000);
    const later = await newEvent(page, "Dinner party", 65 * MINUTE);
    const soonPath = `/api/app/calendar/events/${soon.id}`;
    const laterPath = `/api/app/calendar/events/${later.id}`;
    expect(await alarmOf(page, soonPath)).toBeNull();

    expect((await setAlarm(page, soonPath, 5)).ok()).toBe(true);
    expect((await setAlarm(page, laterPath, 5)).ok()).toBe(true);
    // Only the choices on offer are taken.
    expect((await setAlarm(page, laterPath, 7)).ok()).toBe(false);

    // An alarm that rang with nothing after it is gone; one still ahead stands.
    await expect.poll(() => alarmOf(page, soonPath), { timeout: 30_000 }).toBeNull();
    expect(await alarmOf(page, laterPath)).toBe(5);

    expect((await setAlarm(page, laterPath, null)).ok()).toBe(true);
    expect(await alarmOf(page, laterPath)).toBeNull();
  });

  test("an alarm follows its event when the event moves", async ({ page }) => {
    await signIn(page, OWNER);
    const event = await newEvent(page, "Team sync", 3 * 60 * MINUTE);
    const path = `/api/app/calendar/events/${event.id}`;
    expect((await setAlarm(page, path, 10)).ok()).toBe(true);

    const startAt = Date.now() + 10 * MINUTE + 4_000;
    const moved = await page.request.put(path, {
      data: { startAt, endAt: startAt + 30 * MINUTE },
    });
    expect(moved.ok()).toBe(true);
    await expect.poll(() => alarmOf(page, path), { timeout: 30_000 }).toBeNull();
  });

  test("a repeating event keeps its alarm for the next occurrence", async ({ page }) => {
    await signIn(page, OWNER);
    const startAt = Date.now() + 5 * MINUTE + 4_000;
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Stand-up",
        allDay: false,
        startAt,
        endAt: startAt + 15 * MINUTE,
        timeZone: "UTC",
        rrule: "FREQ=DAILY",
      },
    });
    expect(created.ok()).toBe(true);
    const path = `/api/app/calendar/events/${((await created.json()) as { id: string }).id}`;
    expect((await setAlarm(page, path, 5)).ok()).toBe(true);
    // Past the first ring, it is still set: tomorrow's is ahead.
    await page.waitForTimeout(8_000);
    expect(await alarmOf(page, path)).toBe(5);
  });

  test("an alarm is one's own, on what one can see", async ({ page, browser }) => {
    await signIn(page, OWNER);
    const event = await newEvent(page, "Private", 2 * 60 * MINUTE);
    const eventPath = `/api/app/calendar/events/${event.id}`;
    const created = await page.request.post("/api/app/tasks", {
      data: { title: "Take the bins out", dueDate: "2099-01-01" },
    });
    const taskPath = `/api/app/tasks/${((await created.json()) as { id: string }).id}`;
    expect((await setAlarm(page, taskPath, 120)).ok()).toBe(true);
    expect(await alarmOf(page, taskPath)).toBe(120);

    const other = await browser.newContext();
    const theirs = await other.newPage();
    await signIn(theirs, MEMBER);
    expect((await setAlarm(theirs, eventPath, 15)).status()).toBe(404);
    expect((await setAlarm(theirs, taskPath, 15)).status()).toBe(404);
    await other.close();

    // A task that is removed takes its alarms with it.
    expect((await page.request.delete(taskPath)).ok()).toBe(true);
    expect((await page.request.get(`${taskPath}/alarm`)).status()).toBe(404);
  });

  test("a task with a due day offers the reminder", async ({ page }) => {
    await signIn(page, OWNER);
    const created = await page.request.post("/api/app/tasks", {
      data: { title: "Water the plants", dueDate: "2099-01-01" },
    });
    const { id } = (await created.json()) as { id: string };
    await page.goto("/tasks");
    await page.getByRole("button", { name: "Water the plants" }).click();
    const remind = page.getByRole("dialog").getByRole("combobox", { name: "Remind me" });
    await expect(remind).toHaveValue("No reminder");
    await remind.click();
    await page.getByRole("option", { name: "2 hours before" }).click();
    await expect.poll(() => alarmOf(page, `/api/app/tasks/${id}`)).toBe(120);
  });

  test("the event view sets the reminder", async ({ page }) => {
    await signIn(page, OWNER);
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Lunch",
        allDay: false,
        startAt: start.getTime(),
        endAt: start.getTime() + 30 * MINUTE,
        timeZone: "UTC",
      },
    });
    const { id } = (await created.json()) as { id: string };
    await page.reload();
    await page.getByText("Lunch", { exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    const remind = dialog.getByRole("combobox", { name: "Remind me" });
    await expect(remind).toHaveValue("No reminder");
    await remind.click();
    await page.getByRole("option", { name: "30 minutes before" }).click();
    await expect(remind).toHaveValue("30 minutes before");
    await expect.poll(() => alarmOf(page, `/api/app/calendar/events/${id}`)).toBe(30);
  });
});
