import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

interface EventRow {
  id: string;
  title: string;
  sharedWith: string[];
  attendees: string[];
  permissions: Record<string, string>;
  can: { share: boolean; edit: boolean };
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
  test("view, share and edit each allow what they say", async ({ page, browser }) => {
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
    expect(event.can).toEqual({ share: true, edit: true });
    const path = `/api/app/calendar/events/${event.id}`;
    const give = (level: string) =>
      page.request.put(path, { data: { permissions: { [ids.member]: level } } });

    const member = await memberPage(browser);
    const as = member.page.request;
    try {
      const seen = (await (await as.get(path)).json()) as EventRow;
      expect(seen.can).toEqual({ share: false, edit: false });
      // As the dialog saves: with who it is shared with, unchanged.
      const save = (title: string) =>
        as.put(path, {
          data: { title, sharedWith: seen.sharedWith, attendees: seen.attendees },
        });
      const attend = (attendees: string[]) => as.put(path, { data: { attendees } });

      // Viewing: no changes, no stopping, no single occurrences; hiding is theirs.
      expect((await save("Car service!")).status()).toBe(403);
      expect((await attend([ids.member])).status()).toBe(403);
      expect(
        (await as.post(`${path}/stop`, { data: { from: "2031-11-11" } })).status(),
      ).toBe(403);
      expect((await as.delete(`${path}/occurrences/${start}`)).status()).toBe(403);
      expect((await as.put(`${path}/hidden`, { data: { hidden: false } })).ok()).toBe(
        true,
      );
      const occurrences = (await (
        await as.get(`/api/app/calendar/occurrences?from=${start - 1}&to=${start + 1}`)
      ).json()) as { eventId: string; editable: boolean }[];
      expect(occurrences.find((o) => o.eventId === event.id)?.editable).toBe(false);

      // Sharing: who attends, but no details, no removing, and no more than they have.
      await give("share");
      expect(((await (await as.get(path)).json()) as EventRow).can).toEqual({
        share: true,
        edit: false,
      });
      expect((await attend([ids.member])).ok()).toBe(true);
      expect((await save("Car service!")).status()).toBe(403);
      expect((await as.delete(path)).status()).toBe(403);
      expect(
        (
          await as.put(path, { data: { permissions: { [ids.member]: "edit" } } })
        ).status(),
      ).toBe(403);

      // Editing: all of it, though the dialog's save sends who it is shared with.
      await give("edit");
      const saved = await save("Car service (MOT)");
      expect(saved.ok()).toBe(true);
      expect(((await saved.json()) as EventRow).title).toBe("Car service (MOT)");
      expect((await attend([ids.owner, ids.member])).ok()).toBe(true);
      expect((await as.delete(path)).ok()).toBe(true);
    } finally {
      await member.close();
    }
  });

  test("a household owner does only what an event was shared with them for", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const ids = await idsOf(page);
    const start = Date.UTC(2031, 10, 6, 10);
    const member = await memberPage(browser);
    try {
      const event = (await (
        await member.page.request.post("/api/app/calendar/events", {
          data: {
            title: "Band practice",
            allDay: false,
            startAt: start,
            endAt: start + 3_600_000,
            timeZone: "UTC",
            sharedWith: [ids.owner],
            permissions: { [ids.owner]: "view" },
          },
        })
      ).json()) as EventRow;
      const path = `/api/app/calendar/events/${event.id}`;
      const seen = (await (await page.request.get(path)).json()) as EventRow;
      expect(seen.can).toEqual({ share: false, edit: false });
      expect(
        (await page.request.put(path, { data: { title: "Band practice!" } })).status(),
      ).toBe(403);
      expect((await page.request.put(path, { data: { sharedWith: [] } })).status()).toBe(
        403,
      );
      expect((await page.request.delete(path)).status()).toBe(403);
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

  test("the dialog offers a guest what their level allows", async ({ page, browser }) => {
    await signIn(page, OWNER);
    const ids = await idsOf(page);
    const make = (title: string, hour: number, level?: string) =>
      page.request.post("/api/app/calendar/events", {
        data: {
          title,
          allDay: false,
          startAt: todayAt(hour),
          endAt: todayAt(hour + 1),
          timeZone: "UTC",
          sharedWith: [ids.member],
          ...(level && { permissions: { [ids.member]: level } }),
        },
      });
    await make("Plumber visit", 8);
    await make("School run", 12, "share");
    await make("Surprise party", 20, "view");
    const member = await memberPage(browser);
    try {
      const dialog = member.page.getByRole("dialog");
      const open = (title: string) =>
        member.page.locator("[data-event-id]", { hasText: title }).first().click();
      await open("Plumber visit");
      await expect(dialog.getByText("you can edit it")).toBeVisible();
      await dialog.getByRole("button", { name: "Edit event" }).click();
      // Editing takes sharing with it.
      await expect(dialog.getByLabel("Shared with")).toHaveCount(1);
      await dialog.getByLabel("Title").fill("Plumber visit, bring the key");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
      await expect(
        member.page.getByText("Plumber visit, bring the key", { exact: true }).first(),
      ).toBeVisible();

      await open("School run");
      // Sharing only: who sees it and who attends, and nothing of the event itself.
      await expect(dialog.getByText("you can share it")).toBeVisible();
      await dialog.getByRole("button", { name: "Edit event" }).click();
      await expect(dialog.getByRole("heading", { name: "Share event" })).toBeVisible();
      await expect(dialog.getByLabel("Title")).toHaveCount(0);
      await expect(dialog.getByLabel("Shared with")).toHaveCount(1);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();

      await open("Surprise party");
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
    await page.getByRole("option", { name: "Can share" }).click();
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
    expect(full.permissions[ids.member]).toBe("share");
  });

  test("whoever makes an event in the dialog attends it", async ({ page }) => {
    await signIn(page, OWNER);
    const ids = await idsOf(page);
    await page.getByRole("button", { name: "New event" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Haircut");
    await dialog.getByRole("button", { name: "Add event" }).click();
    await expect(dialog).toBeHidden();
    const now = Date.now();
    const events = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${now}&to=${now + 3 * 3_600_000}`,
      )
    ).json()) as { eventId: string; title: string }[];
    const made = events.find((o) => o.title === "Haircut")!;
    const full = (await (
      await page.request.get(`/api/app/calendar/events/${made.eventId}`)
    ).json()) as EventRow;
    expect(full.attendees).toEqual([ids.owner]);
  });
});
