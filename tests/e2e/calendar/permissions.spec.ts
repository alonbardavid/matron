import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

interface EventRow {
  id: string;
  title: string;
  sharedWith: string[];
  attendees: string[];
  permissions: Record<string, string>;
  can: { edit: boolean; manage: boolean };
}

/** An hour of today, local to the browser, for an event the week view shows. */
function todayAt(hour: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour).getTime();
}

async function memberPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, MEMBER);
  return { page, close: () => context.close() };
}

async function idsOf(page: Page) {
  const users = (await (await page.request.get("/api/app/users")).json()) as {
    id: string;
    email: string;
  }[];
  return {
    owner: users.find((u) => u.email === OWNER.email)!.id,
    member: users.find((u) => u.email === MEMBER.email)!.id,
  };
}

test.describe("what guests may do", () => {
  test("view, edit and manage each allow what they say", async ({ page, browser }) => {
    await signIn(page, OWNER);
    const ids = await idsOf(page);
    const start = Date.UTC(2031, 10, 4, 10);
    const event = (await (
      await page.request.post("/api/app/calendar/events", {
        data: {
          title: "Car service",
          allDay: false,
          startAt: start,
          endAt: start + 3_600_000,
          timeZone: "UTC",
          rrule: "FREQ=WEEKLY;COUNT=3",
          sharedWith: [ids.member],
          permissions: { [ids.member]: "view" },
        },
      })
    ).json()) as EventRow;
    expect(event.permissions).toEqual({ [ids.member]: "view" });
    expect(event.can).toEqual({ edit: true, manage: true });

    const member = await memberPage(browser);
    const as = member.page.request;
    try {
      const seen = (await (
        await as.get(`/api/app/calendar/events/${event.id}`)
      ).json()) as EventRow;
      expect(seen.can).toEqual({ edit: false, manage: false });
      // Viewing: no changes, no stopping, no single occurrences; answering and hiding are theirs.
      const save = (title: string, extra: Record<string, unknown> = {}) =>
        as.put(`/api/app/calendar/events/${event.id}`, {
          // As the dialog saves: with who it is shared with, unchanged.
          data: {
            title,
            sharedWith: seen.sharedWith,
            attendees: seen.attendees,
            ...extra,
          },
        });
      expect((await save("Car service!")).status()).toBe(403);
      expect(
        (
          await as.post(`/api/app/calendar/events/${event.id}/stop`, {
            data: { from: "2031-11-11" },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await as.delete(`/api/app/calendar/events/${event.id}/occurrences/${start}`)
        ).status(),
      ).toBe(403);
      expect(
        (
          await as.put(`/api/app/calendar/events/${event.id}/reply`, {
            data: { response: "tentative" },
          })
        ).ok(),
      ).toBe(true);
      const occurrences = (await (
        await as.get(`/api/app/calendar/occurrences?from=${start - 1}&to=${start + 1}`)
      ).json()) as { eventId: string; editable: boolean }[];
      expect(occurrences.find((o) => o.eventId === event.id)?.editable).toBe(false);

      // Editing: the dialog's save goes through, though it sends who it is shared with.
      await page.request.put(`/api/app/calendar/events/${event.id}`, {
        data: { permissions: { [ids.member]: "edit" } },
      });
      const saved = await save("Car service (MOT)");
      expect(saved.ok()).toBe(true);
      expect(((await saved.json()) as EventRow).title).toBe("Car service (MOT)");
      // ...but changing who it is shared with, or removing it, is for managers.
      expect(
        (await save("Car service (MOT)", { attendees: [ids.member] })).status(),
      ).toBe(403);
      expect((await as.delete(`/api/app/calendar/events/${event.id}`)).status()).toBe(
        403,
      );
      // Their answer and level survived the owner's change of level.
      const after = (await (
        await as.get(`/api/app/calendar/events/${event.id}`)
      ).json()) as {
        replies: Record<string, string>;
      };
      expect(after.replies[ids.member]).toBe("tentative");

      // Managing: who attends, and removing it.
      await page.request.put(`/api/app/calendar/events/${event.id}`, {
        data: { permissions: { [ids.member]: "manage" } },
      });
      expect((await save("Car service (MOT)", { attendees: [ids.member] })).ok()).toBe(
        true,
      );
      expect((await as.delete(`/api/app/calendar/events/${event.id}`)).ok()).toBe(true);
    } finally {
      await member.close();
    }
  });

  test("a guest leaves an event shared with them", async ({ page, browser }) => {
    await signIn(page, OWNER);
    const ids = await idsOf(page);
    const start = Date.UTC(2031, 10, 5, 10);
    const event = (await (
      await page.request.post("/api/app/calendar/events", {
        data: {
          title: "Neighbourhood meeting",
          allDay: false,
          startAt: start,
          endAt: start + 3_600_000,
          timeZone: "UTC",
          sharedWith: [ids.member],
        },
      })
    ).json()) as EventRow;
    const member = await memberPage(browser);
    try {
      expect(
        (
          await member.page.request.delete(`/api/app/calendar/events/${event.id}/share`)
        ).ok(),
      ).toBe(true);
      expect(
        (await member.page.request.get(`/api/app/calendar/events/${event.id}`)).status(),
      ).toBe(404);
    } finally {
      await member.close();
    }
    const now = (await (
      await page.request.get(`/api/app/calendar/events/${event.id}`)
    ).json()) as EventRow;
    expect(now.sharedWith).toEqual([]);
  });

  test("a guest who may edit saves from the dialog; one who may view only sees it", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const ids = await idsOf(page);
    await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Plumber visit",
        allDay: false,
        startAt: todayAt(8),
        endAt: todayAt(9),
        timeZone: "UTC",
        sharedWith: [ids.member],
      },
    });
    await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Surprise party",
        allDay: false,
        startAt: todayAt(20),
        endAt: todayAt(22),
        timeZone: "UTC",
        sharedWith: [ids.member],
        permissions: { [ids.member]: "view" },
      },
    });
    const member = await memberPage(browser);
    try {
      const dialog = member.page.getByRole("dialog");
      await member.page
        .locator("[data-event-id]", { hasText: "Plumber visit" })
        .first()
        .click();
      await expect(dialog.getByText("you can edit it")).toBeVisible();
      await dialog.getByRole("button", { name: "Edit event" }).click();
      // Who it is shared with is for managers: not in this guest's form.
      await expect(dialog.getByRole("textbox", { name: "Shared with" })).toHaveCount(0);
      await dialog.getByLabel("Title").fill("Plumber visit, bring the key");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      await expect(
        member.page.getByText("Plumber visit, bring the key", { exact: true }).first(),
      ).toBeVisible();

      await member.page
        .locator("[data-event-id]", { hasText: "Surprise party" })
        .first()
        .click();
      // Viewing only: it reads, and offers nothing to change.
      await expect(dialog.getByText("you can view it")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Edit event" })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Leave event" })).toBeVisible();
    } finally {
      await member.close();
    }

    // The owner sets the level per person in the dialog.
    await page.reload();
    await page.locator("[data-event-id]", { hasText: "Plumber visit" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Edit event" }).click();
    const level = dialog.getByRole("combobox", { name: "What Max Member may do" });
    await expect(level).toHaveValue("Can edit");
    await level.click();
    await page.getByRole("option", { name: "Can manage" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    const events = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${todayAt(0)}&to=${todayAt(24)}`,
      )
    ).json()) as { eventId: string; title: string }[];
    const plumber = events.find((o) => o.title.startsWith("Plumber visit"))!;
    const full = (await (
      await page.request.get(`/api/app/calendar/events/${plumber.eventId}`)
    ).json()) as EventRow;
    expect(full.permissions[ids.member]).toBe("manage");
  });
});
