import { expect, test, type APIRequestContext } from "@playwright/test";
import { signIn } from "../helpers";
import { OWNER } from "../users";

const DAY = 86_400_000;

interface OccurrenceRow {
  eventId: string;
  title: string;
  startAt: number;
  originalStartAt: number | null;
  changed: boolean;
}

async function occurrences(
  request: APIRequestContext,
  eventId: string,
  from: number,
  to: number,
): Promise<OccurrenceRow[]> {
  const list = (await (
    await request.get(`/api/app/calendar/occurrences?from=${from}&to=${to}`)
  ).json()) as OccurrenceRow[];
  return list.filter((o) => o.eventId === eventId);
}

test.describe("repeating events (iCalendar)", () => {
  test("RRULEs expand in the event's zone, and one occurrence changes alone", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const request = page.request;
    // Tuesday 13 Oct 2026, 09:00 in London (BST); the clocks go back on the 25th.
    const start = Date.UTC(2026, 9, 13, 8, 0, 0);
    const created = await request.post("/api/app/calendar/events", {
      data: {
        title: "Swimming",
        allDay: false,
        startAt: start,
        endAt: start + 3_600_000,
        timeZone: "Europe/London",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20261222",
      },
    });
    expect(created.ok()).toBeTruthy();
    const event = (await created.json()) as { id: string; rrule: string };
    // A day-valued UNTIL is stored as the UTC instant that day ends in London.
    expect(event.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20261222T235959Z");

    const all = await occurrences(request, event.id, start - DAY, start + 120 * DAY);
    expect(all.map((o) => new Date(o.startAt).toISOString())).toEqual([
      "2026-10-13T08:00:00.000Z",
      "2026-10-27T09:00:00.000Z", // still 09:00 in London, after the change
      "2026-11-10T09:00:00.000Z",
      "2026-11-24T09:00:00.000Z",
      "2026-12-08T09:00:00.000Z",
      "2026-12-22T09:00:00.000Z",
    ]);

    // Move one, cancel another; the rest keep the series' own.
    const moved = all[1]!.originalStartAt!;
    const edit = await request.put(
      `/api/app/calendar/events/${event.id}/occurrences/${moved}`,
      {
        data: {
          title: "Swimming (gala)",
          startAt: moved + 6 * 3_600_000,
          endAt: moved + 8 * 3_600_000,
        },
      },
    );
    expect(edit.ok()).toBeTruthy();
    const cancelled = all[2]!.originalStartAt!;
    expect(
      (
        await request.delete(
          `/api/app/calendar/events/${event.id}/occurrences/${cancelled}`,
        )
      ).ok(),
    ).toBeTruthy();
    const after = await occurrences(request, event.id, start - DAY, start + 120 * DAY);
    expect(after).toHaveLength(5);
    expect(after[1]).toMatchObject({
      title: "Swimming (gala)",
      startAt: moved + 6 * 3_600_000,
      changed: true,
    });
    expect(after.some((o) => o.originalStartAt === cancelled)).toBe(false);

    // No occurrence is due at a time the series does not have.
    expect(
      (
        await request.delete(
          `/api/app/calendar/events/${event.id}/occurrences/${moved + 3_600_000}`,
        )
      ).status(),
    ).toBe(404);

    // Stopping keeps what came before the day.
    await request.post(`/api/app/calendar/events/${event.id}/stop`, {
      data: { from: "2026-11-24" },
    });
    expect(
      (await occurrences(request, event.id, start - DAY, start + 120 * DAY)).length,
    ).toBe(2);
  });

  test("nth weekdays and bad rules", async ({ page }) => {
    await signIn(page, OWNER);
    const start = Date.UTC(2031, 0, 31, 18, 0, 0); // Friday 31 Jan 2031
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Book club",
        allDay: false,
        startAt: start,
        endAt: start + 7_200_000,
        timeZone: "UTC",
        rrule: "FREQ=MONTHLY;BYDAY=-1FR;COUNT=3",
      },
    });
    const event = (await created.json()) as { id: string };
    const days = (
      await occurrences(page.request, event.id, start - DAY, start + 120 * DAY)
    ).map((o) => new Date(o.startAt).toISOString().slice(0, 10));
    expect(days).toEqual(["2031-01-31", "2031-02-28", "2031-03-28"]);

    const bad = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Too often",
        allDay: false,
        startAt: start,
        endAt: start + 60_000,
        timeZone: "UTC",
        rrule: "FREQ=MINUTELY",
      },
    });
    expect(bad.status()).toBe(400);
  });

  test("the repeat editor writes the rule and says it in words", async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole("button", { name: "New event" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Bins out");
    await dialog.getByText("Monthly", { exact: true }).click();
    await dialog.getByText("On a weekday", { exact: true }).click();
    await dialog.getByRole("combobox", { name: "Which" }).click();
    await page.getByRole("option", { name: "Last" }).click();
    await expect(dialog.getByText(/^Every month on the last /)).toBeVisible();
    await dialog.getByRole("textbox", { name: "Every how many" }).fill("2");
    await expect(dialog.getByText(/^Every 2 months on the last /)).toBeVisible();
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/app/calendar/events") && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Add event" }).click();
    const body = (await (await saved).json()) as { rrule: string };
    expect(body.rrule).toMatch(
      /^FREQ=MONTHLY;INTERVAL=2;BYDAY=-1(MO|TU|WE|TH|FR|SA|SU)$/,
    );
  });
});
