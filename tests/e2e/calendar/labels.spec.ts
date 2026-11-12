import { expect, test, type Browser } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

interface LabelRow {
  id: string;
  name: string;
  color: string;
}

async function memberPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, MEMBER);
  return { page, close: () => context.close() };
}

/** Ten o'clock today, local to the browser, for an event the week view shows. */
function todayAt(hour: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour).getTime();
}

test.describe("labels", () => {
  test("the household's labels tag events, and only their maker or an owner changes them", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const made = await page.request.post("/api/app/calendar/labels", {
      data: { name: "Medical", color: "#C0392B" },
    });
    expect(made.ok()).toBeTruthy();
    const medical = (await made.json()) as LabelRow;
    expect(medical.color).toBe("#c0392b");

    const start = Date.UTC(2031, 4, 6, 9, 0, 0);
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Check-up",
        allDay: false,
        startAt: start,
        endAt: start + 3_600_000,
        timeZone: "UTC",
        rrule: "FREQ=WEEKLY;COUNT=2",
        labelIds: [medical.id],
      },
    });
    expect(created.ok()).toBeTruthy();
    const event = (await created.json()) as { id: string; labelIds: string[] };
    expect(event.labelIds).toEqual([medical.id]);
    // Every occurrence of the series carries them.
    const occurrences = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${start - 1}&to=${start + 8 * 86_400_000}`,
      )
    ).json()) as { eventId: string; labelIds: string[] }[];
    const mine = occurrences.filter((o) => o.eventId === event.id);
    expect(mine).toHaveLength(2);
    expect(mine.every((o) => o.labelIds.includes(medical.id))).toBe(true);

    // An unknown label is refused.
    expect(
      (
        await page.request.put(`/api/app/calendar/events/${event.id}`, {
          data: { labelIds: ["LB_nope"] },
        })
      ).status(),
    ).toBe(400);

    // A member sees and uses the household's labels but changes only their own.
    const member = await memberPage(browser);
    try {
      const seen = (await (
        await member.page.request.get("/api/app/calendar/labels")
      ).json()) as LabelRow[];
      expect(seen.map((l) => l.name)).toContain("Medical");
      expect(
        (
          await member.page.request.put(`/api/app/calendar/labels/${medical.id}`, {
            data: { name: "Doctor" },
          })
        ).status(),
      ).toBe(403);
    } finally {
      await member.close();
    }

    // Removing a label takes it off its events.
    expect(
      (await page.request.delete(`/api/app/calendar/labels/${medical.id}`)).ok(),
    ).toBe(true);
    const after = (await (
      await page.request.get(`/api/app/calendar/events/${event.id}`)
    ).json()) as { labelIds: string[] };
    expect(after.labelIds).toEqual([]);
  });

  test("a label made in the event shows as a bar on the event", async ({ page }) => {
    await signIn(page, OWNER);
    const start = todayAt(10);
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Parents' evening",
        allDay: false,
        startAt: start,
        endAt: start + 3_600_000,
        timeZone: "UTC",
      },
    });
    expect(created.ok()).toBeTruthy();
    await page.reload();
    await page.getByText("Parents' evening", { exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Edit event" }).click();
    await dialog.getByRole("combobox", { name: "Labels" }).fill("School");
    await page.getByRole("option", { name: "Create “School”" }).click();
    await expect(dialog.getByText("School", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    const event = page
      .locator("[data-event-id]", { hasText: "Parents' evening" })
      .first();
    await expect(event.getByTestId("label-bars").locator("span")).toHaveCount(1);
    await expect(event.getByTestId("label-bars").locator("span")).toHaveAttribute(
      "title",
      "School",
    );

    // Settings lists it, to rename and recolour.
    await navLink(page, "Settings").click();
    await expect(page.getByText("Labels", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Label title" })).toHaveValue(
      "School",
    );
  });
});
