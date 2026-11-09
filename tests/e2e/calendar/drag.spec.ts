import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

const HOUR = 3_600_000;

/** An hour of a day this week (0 today), local to the browser, for an event the week view shows. */
function dayAt(hour: number, days = 0): number {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + days,
    hour,
  ).getTime();
}

async function addEvent(page: Page, data: Record<string, unknown>) {
  const created = await page.request.post("/api/app/calendar/events", {
    data: { allDay: false, timeZone: "UTC", ...data },
  });
  expect(created.ok()).toBeTruthy();
  return (await created.json()) as { id: string };
}

async function occurrencesOf(page: Page, eventId: string, from: number, to: number) {
  return (
    (await (
      await page.request.get(`/api/app/calendar/occurrences?from=${from}&to=${to}`)
    ).json()) as { eventId: string; startAt: number; endAt: number; editable: boolean }[]
  ).filter((o) => o.eventId === eventId);
}

function onCalendar(page: Page, title: string) {
  return page.locator("[data-event-id]", { hasText: title }).first();
}

/** One hour of the week view, in pixels: its slot height. */
async function hourHeight(page: Page): Promise<number> {
  const first = page.getByText("09:00", { exact: true }).first();
  const second = page.getByText("10:00", { exact: true }).first();
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  return b!.y - a!.y;
}

test.describe("drag to move and resize", () => {
  test("an event moves later by dragging and grows from its bottom edge", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const event = await addEvent(page, {
      title: "Haircut",
      startAt: dayAt(10),
      endAt: dayAt(11),
    });
    await page.reload();
    const block = onCalendar(page, "Haircut");
    await expect(block).toHaveAttribute("data-draggable", "true");
    const hour = await hourHeight(page);

    const box = (await block.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 2 * hour, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await occurrencesOf(page, event.id, dayAt(0), dayAt(24)))[0]?.startAt,
      )
      .toBe(dayAt(12));
    const [moved] = await occurrencesOf(page, event.id, dayAt(0), dayAt(24));
    expect(moved!.endAt - moved!.startAt).toBe(HOUR);

    // Stretch it by an hour from its bottom edge.
    await page.reload();
    const handle = onCalendar(page, "Haircut").locator(
      ".mantine-ScheduleEvent-eventResizeHandle[data-edge='bottom']",
    );
    const edge = (await handle.boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2 + hour, {
      steps: 8,
    });
    await page.mouse.up();
    await expect
      .poll(
        async () => (await occurrencesOf(page, event.id, dayAt(0), dayAt(24)))[0]?.endAt,
      )
      .toBe(dayAt(14));
  });

  test("dragging one occurrence of a series moves it alone", async ({ page }) => {
    await signIn(page, OWNER);
    const event = await addEvent(page, {
      title: "Stretching",
      startAt: dayAt(9),
      endAt: dayAt(9) + HOUR / 2,
      rrule: "FREQ=DAILY;COUNT=2",
    });
    await page.reload();
    const hour = await hourHeight(page);
    const block = onCalendar(page, "Stretching");
    const box = (await block.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 3 * hour, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await occurrencesOf(page, event.id, dayAt(0), dayAt(0, 2))).map((o) =>
          new Date(o.startAt).getHours(),
        ),
      )
      .toEqual([12, 9]);
  });

  test("an event in a calendar shared read-only does not move", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const users = (await (await page.request.get("/api/app/users")).json()) as {
      id: string;
      email: string;
    }[];
    const member = users.find((u) => u.email === MEMBER.email)!;
    const calendar = (await (
      await page.request.post("/api/app/calendar/calendars", {
        data: { name: "Work", color: "#3b6fd1" },
      })
    ).json()) as { id: string };
    await page.request.put(`/api/app/calendar/calendars/${calendar.id}`, {
      data: { sharedWith: [member.id] },
    });
    const event = await addEvent(page, {
      title: "Board meeting",
      calendarId: calendar.id,
      startAt: dayAt(15),
      endAt: dayAt(16),
    });
    const context = await browser.newContext();
    const other = await context.newPage();
    try {
      await signIn(other, MEMBER);
      const [seen] = await occurrencesOf(other, event.id, dayAt(0), dayAt(24));
      expect(seen!.editable).toBe(false);
      await expect(onCalendar(other, "Board meeting")).not.toHaveAttribute(
        "data-draggable",
        "true",
      );
    } finally {
      await context.close();
    }
  });
});
