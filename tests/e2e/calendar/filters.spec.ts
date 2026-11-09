import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

/** An hour of today, local to the browser, for an item the week view shows. */
function todayAt(hour: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour).getTime();
}

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function addEvent(page: Page, data: Record<string, unknown>) {
  const created = await page.request.post("/api/app/calendar/events", {
    data: { allDay: false, timeZone: "UTC", ...data },
  });
  expect(created.ok()).toBeTruthy();
  return (await created.json()) as { id: string; hidden: boolean };
}

function onCalendar(page: Page, title: string) {
  return page.locator("[data-event-id]", { hasText: title });
}

async function openFilters(page: Page) {
  await page.getByRole("button", { name: "Filters" }).click();
  return page.getByRole("group", { name: "Calendar filters" });
}

test.describe("hiding events and filtering the calendar", () => {
  test("hiding is the member's own, and every occurrence goes", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const members = (await (await page.request.get("/api/app/users")).json()) as {
      id: string;
      email: string;
    }[];
    const member = members.find((m) => m.email === MEMBER.email)!;
    const start = Date.UTC(2031, 6, 1, 9);
    const event = await addEvent(page, {
      title: "Book club",
      startAt: start,
      endAt: start + 3_600_000,
      rrule: "FREQ=WEEKLY;COUNT=3",
      sharedWith: [member.id],
    });
    expect(event.hidden).toBe(false);
    const hidden = await page.request.put(`/api/app/calendar/events/${event.id}/hidden`, {
      data: { hidden: true },
    });
    expect(((await hidden.json()) as { hidden: boolean }).hidden).toBe(true);
    const list = async (p: Page) =>
      (
        (await (
          await p.request.get(
            `/api/app/calendar/occurrences?from=${start - 1}&to=${start + 21 * 86_400_000}`,
          )
        ).json()) as { eventId: string; hidden: boolean }[]
      ).filter((o) => o.eventId === event.id);
    // Still listed, marked hidden, so the calendar can show it when asked.
    expect((await list(page)).map((o) => o.hidden)).toEqual([true, true, true]);

    const context = await browser.newContext();
    const other = await context.newPage();
    try {
      await signIn(other, MEMBER);
      expect((await list(other)).map((o) => o.hidden)).toEqual([false, false, false]);
    } finally {
      await context.close();
    }

    await page.request.put(`/api/app/calendar/events/${event.id}/hidden`, {
      data: { hidden: false },
    });
    expect((await list(page)).every((o) => !o.hidden)).toBe(true);
  });

  test("a hidden event comes back through the filters and is unhidden from its dialog", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    await addEvent(page, {
      title: "Piano lesson",
      startAt: todayAt(16),
      endAt: todayAt(17),
    });
    await page.reload();
    await onCalendar(page, "Piano lesson").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(onCalendar(page, "Piano lesson")).toHaveCount(0);

    const filters = await openFilters(page);
    await filters.getByRole("switch", { name: "Hidden events" }).click();
    await page.keyboard.press("Escape");
    await expect(onCalendar(page, "Piano lesson").first()).toHaveAttribute(
      "data-muted",
      "true",
    );
    // The choice is this device's: it outlives a reload.
    await page.reload();
    await onCalendar(page, "Piano lesson").first().click();
    await expect(dialog.getByText("Hidden from your calendar")).toBeVisible();
    await dialog.getByRole("button", { name: "Unhide" }).click();
    await expect(dialog).toBeHidden();
    await expect(onCalendar(page, "Piano lesson").first()).not.toHaveAttribute(
      "data-muted",
    );

    const again = await openFilters(page);
    await again.getByRole("button", { name: "Reset filters" }).click();
    await expect(again.getByRole("switch", { name: "Hidden events" })).not.toBeChecked();
  });

  test("calendars and tasks with a due date are shown or left out", async ({ page }) => {
    await signIn(page, OWNER);
    const made = await page.request.post("/api/app/calendar/calendars", {
      data: { name: "Garden", color: "#16a085" },
    });
    const garden = (await made.json()) as { id: string };
    await addEvent(page, {
      title: "Mow the lawn",
      calendarId: garden.id,
      startAt: todayAt(8),
      endAt: todayAt(9),
    });
    const task = await page.request.post("/api/app/tasks", {
      data: { title: "Pay the water bill", dueDate: today() },
    });
    expect(task.ok()).toBeTruthy();
    await page.reload();
    await expect(onCalendar(page, "Mow the lawn")).toHaveCount(1);
    await expect(onCalendar(page, "Pay the water bill")).toHaveCount(1);

    const filters = await openFilters(page);
    await filters.getByRole("checkbox", { name: "Garden" }).uncheck();
    await filters.getByRole("switch", { name: "Tasks with a due date" }).click();
    await expect(onCalendar(page, "Mow the lawn")).toHaveCount(0);
    await expect(onCalendar(page, "Pay the water bill")).toHaveCount(0);

    await filters.getByRole("checkbox", { name: "Garden" }).check();
    await filters.getByRole("switch", { name: "Tasks with a due date" }).click();
    await page.keyboard.press("Escape");
    // A task opens in the task dialog.
    await onCalendar(page, "Pay the water bill").first().click();
    await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue(
      "Pay the water bill",
    );
  });
});
