import { expect, test } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { OWNER } from "../users";

interface CalendarRow {
  id: string;
  name: string;
  color: string;
  source: string;
  isDefault: boolean;
}

test.describe("calendars", () => {
  test("events belong to a calendar and take its colour", async ({ page }) => {
    await signIn(page, OWNER);
    const listed = await page.request.get("/api/app/calendar/calendars");
    const calendars = (await listed.json()) as CalendarRow[];
    const main = calendars.find((c) => c.isDefault)!;
    expect(main).toMatchObject({ source: "matron" });

    const created = await page.request.post("/api/app/calendar/calendars", {
      data: { name: "Kids", color: "#3B6FD1" },
    });
    expect(created.ok()).toBeTruthy();
    const kids = (await created.json()) as CalendarRow;
    expect(kids.color).toBe("#3b6fd1");

    const start = Date.UTC(2031, 2, 3, 15, 0, 0);
    const span = {
      allDay: false,
      startAt: start,
      endAt: start + 3_600_000,
      timeZone: "UTC",
    };
    const inDefault = await page.request.post("/api/app/calendar/events", {
      data: { title: "Dentist", ...span },
    });
    const inKids = await page.request.post("/api/app/calendar/events", {
      data: { title: "Football", calendarId: kids.id, ...span },
    });
    expect(((await inDefault.json()) as { calendarId: string }).calendarId).toBe(main.id);
    expect(((await inKids.json()) as { calendarId: string }).calendarId).toBe(kids.id);

    const occurrences = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${start - 1}&to=${start + 3_600_001}`,
      )
    ).json()) as { title: string; color: string; source: string }[];
    expect(occurrences.find((o) => o.title === "Football")).toMatchObject({
      color: "#3b6fd1",
      source: "matron",
    });

    // The default stays; another calendar goes with its events.
    expect(
      (await page.request.delete(`/api/app/calendar/calendars/${main.id}`)).status(),
    ).toBe(409);
    expect(
      (await page.request.delete(`/api/app/calendar/calendars/${kids.id}`)).ok(),
    ).toBe(true);
    const after = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${start - 1}&to=${start + 3_600_001}`,
      )
    ).json()) as { title: string }[];
    expect(after.map((o) => o.title)).not.toContain("Football");
  });

  test("a member manages their calendars in settings", async ({ page }) => {
    await signIn(page, OWNER);
    await navLink(page, "Settings").click();
    await expect(page.getByText("Calendars", { exact: true })).toBeVisible();
    await page.getByLabel("New calendar").fill("Work");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Calendar title" }).last(),
    ).toHaveValue("Work");
    await page.getByRole("button", { name: "Remove Work" }).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Remove Work and every event in it?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByRole("textbox", { name: "Calendar title" })).toHaveCount(1);
  });
});
