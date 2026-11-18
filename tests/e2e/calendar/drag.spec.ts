import { devices, expect, test, type Page } from "@playwright/test";
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

/** A day of this week other specs leave empty (they use today): tomorrow, or yesterday on a Sunday, the week's last. */
const OWN_DAY = new Date().getDay() === 0 ? -1 : 1;

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
  test.beforeEach(async ({ page }) => {
    // The week view opens with now in its middle: here, the events' morning.
    await page.clock.setFixedTime(new Date(dayAt(10) + 30 * 60_000));
  });

  test("an event moves later by dragging and grows from its bottom edge", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const event = await addEvent(page, {
      title: "Haircut",
      startAt: dayAt(10, OWN_DAY),
      endAt: dayAt(11, OWN_DAY),
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
          (await occurrencesOf(page, event.id, dayAt(0, OWN_DAY), dayAt(24, OWN_DAY)))[0]
            ?.startAt,
      )
      .toBe(dayAt(12, OWN_DAY));
    const [moved] = await occurrencesOf(
      page,
      event.id,
      dayAt(0, OWN_DAY),
      dayAt(24, OWN_DAY),
    );
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
        async () =>
          (await occurrencesOf(page, event.id, dayAt(0, OWN_DAY), dayAt(24, OWN_DAY)))[0]
            ?.endAt,
      )
      .toBe(dayAt(14, OWN_DAY));
  });

  test("an event off the quarter hour keeps its minutes when moved", async ({ page }) => {
    await signIn(page, OWNER);
    const MIN = 60_000;
    const event = await addEvent(page, {
      title: "School run",
      startAt: dayAt(10) + 5 * MIN,
      endAt: dayAt(10) + 50 * MIN,
    });
    await page.reload();
    const hour = await hourHeight(page);
    const box = (await onCalendar(page, "School run").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + hour, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await occurrencesOf(page, event.id, dayAt(0), dayAt(24)))[0]?.startAt,
      )
      .toBe(dayAt(11) + 5 * MIN);
    const [moved] = await occurrencesOf(page, event.id, dayAt(0), dayAt(24));
    expect(moved!.endAt).toBe(dayAt(11) + 50 * MIN);
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

/** A finger on the page: down at a point, moved by steps, and lifted; held first when `holdMs` is given. */
async function fingerDrag(
  page: Page,
  from: { x: number; y: number },
  dy: number,
  holdMs = 0,
) {
  const cdp = await page.context().newCDPSession(page);
  const { x } = from;
  let { y } = from;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd") =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  await touch("touchStart");
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 0; i < 20; i++) {
    y += dy / 20;
    await touch("touchMove");
    await page.waitForTimeout(16);
  }
  await touch("touchEnd");
}

test.describe("drag with a finger", () => {
  // A phone: touch only, with a phone's browser.
  const { defaultBrowserType: _browser, ...phone } = devices["Pixel 7"];
  test.use(phone);
  test.beforeEach(async ({ page }) => {
    // The day view opens with now in its middle: here, the evening of this spec's own day, clear
    // of the events other specs make today at times that follow the real clock.
    await page.clock.setFixedTime(new Date(dayAt(19, OWN_DAY) + 30 * 60_000));
  });

  test("an event held moves where it is dragged; one stretched from its edge grows", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const event = await addEvent(page, {
      title: "Physio",
      startAt: dayAt(18, OWN_DAY),
      endAt: dayAt(19, OWN_DAY),
    });
    await page.reload();
    const block = onCalendar(page, "Physio");
    await expect(block).toBeVisible();
    const hour = await hourHeight(page);

    const box = (await block.boundingBox())!;
    await fingerDrag(
      page,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      2 * hour,
      500,
    );
    await expect
      .poll(
        async () =>
          (await occurrencesOf(page, event.id, dayAt(0, OWN_DAY), dayAt(24, OWN_DAY)))[0]
            ?.startAt,
      )
      .toBe(dayAt(20, OWN_DAY));

    const moved = (await block.boundingBox())!;
    await fingerDrag(
      page,
      { x: moved.x + moved.width / 2, y: moved.y + moved.height - 1 },
      hour,
    );
    await expect
      .poll(
        async () =>
          (await occurrencesOf(page, event.id, dayAt(0, OWN_DAY), dayAt(24, OWN_DAY)))[0]
            ?.endAt,
      )
      .toBe(dayAt(22, OWN_DAY));
  });

  test("a quick swipe over an event scrolls the day and leaves the event", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const event = await addEvent(page, {
      title: "Piano",
      startAt: dayAt(17, OWN_DAY),
      endAt: dayAt(18, OWN_DAY),
    });
    await page.reload();
    const block = onCalendar(page, "Piano");
    await expect(block).toBeVisible();
    const before = (await block.boundingBox())!;
    await fingerDrag(
      page,
      { x: before.x + before.width / 2, y: before.y + before.height / 2 },
      150,
    );
    await expect
      .poll(async () => (await block.boundingBox())!.y)
      .toBeGreaterThan(before.y + 50);
    await page.waitForTimeout(500);
    expect(
      (await occurrencesOf(page, event.id, dayAt(0, OWN_DAY), dayAt(24, OWN_DAY)))[0]
        ?.startAt,
    ).toBe(dayAt(17, OWN_DAY));
  });
});
