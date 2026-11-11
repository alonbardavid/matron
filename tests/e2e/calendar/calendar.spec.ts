import { expect, test } from "@playwright/test";
import { signIn } from "../helpers";
import { OWNER } from "../users";

const DAY = 86_400_000;

test.describe("calendar", () => {
  test("a repeating event is expanded into occurrences and can be stopped", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const timeZone = "UTC";
    const start = Date.UTC(2030, 0, 7, 9, 0, 0); // a Monday
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Piano lesson",
        allDay: false,
        startAt: start,
        endAt: start + 60 * 60_000,
        timeZone,
        rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      },
    });
    expect(created.ok()).toBeTruthy();
    const event = (await created.json()) as { id: string };

    const list = async () => {
      const response = await page.request.get(
        `/api/app/calendar/occurrences?from=${start - DAY}&to=${start + 60 * DAY}`,
      );
      return (await response.json()) as {
        id: string;
        startAt: number;
        eventId: string;
      }[];
    };
    const occurrences = (await list()).filter((o) => o.eventId === event.id);
    expect(occurrences).toHaveLength(4);
    expect(occurrences[1]!.startAt - occurrences[0]!.startAt).toBe(7 * DAY);

    // Stop from the third one on: the first two stay.
    const stopped = await page.request.post(`/api/app/calendar/events/${event.id}/stop`, {
      data: { from: "2030-01-21" },
    });
    expect(stopped.ok()).toBeTruthy();
    expect((await list()).filter((o) => o.eventId === event.id)).toHaveLength(2);
  });

  test("an event shows on the calendar and opens for editing", async ({ page }) => {
    await signIn(page, OWNER);
    const today = new Date();
    const start = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      10,
      0,
      0,
    );
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Dentist",
        allDay: false,
        startAt: start.getTime(),
        endAt: start.getTime() + 30 * 60_000,
        timeZone: "UTC",
      },
    });
    expect(created.ok()).toBeTruthy();
    await page.reload();
    await page.getByText("Dentist", { exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    // An event opens as it reads; the pencil turns it into the form.
    await expect(dialog.getByRole("heading", { name: "Dentist" })).toBeVisible();
    await expect(dialog.getByLabel("Title")).toBeHidden();
    await dialog.getByRole("button", { name: "Edit event" }).click();
    await expect(dialog.getByLabel("Title")).toHaveValue("Dentist");
    await dialog.getByLabel("Title").fill("Dentist, moved");
    await dialog.getByLabel("Title").press("Enter");
    await expect(page.getByText("Dentist, moved", { exact: true }).first()).toBeVisible();
  });
});

test.describe("calendar on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the top bar names the page and the toolbar picks the view and the date", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    await expect(
      page.getByRole("banner").getByRole("heading", { name: "Calendar" }),
    ).toBeVisible();
    const view = page.getByRole("combobox", { name: "View" });
    await expect(view).toHaveValue("Day");
    await view.click();
    await page.getByRole("option", { name: "Week" }).click();
    await expect(view).toHaveValue("Week");
    await page.getByRole("button", { name: "Pick a date" }).click();
    await expect(page.getByText("Mo", { exact: true })).toBeVisible();
  });
});
