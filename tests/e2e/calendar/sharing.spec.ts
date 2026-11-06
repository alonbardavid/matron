import { expect, test, type APIRequestContext } from "@playwright/test";
import { signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

interface CalendarRow {
  id: string;
  name: string;
  color: string;
  access: string;
  isDefault: boolean;
  receivesShared: boolean;
  sharedWith: string[];
}
interface OccurrenceRow {
  eventId: string;
  title: string;
  calendarId: string;
  color: string;
}

const START = Date.UTC(2032, 4, 10, 17, 0, 0);
const SPAN = { allDay: false, startAt: START, endAt: START + 3_600_000, timeZone: "UTC" };

async function calendars(request: APIRequestContext): Promise<CalendarRow[]> {
  return (await (
    await request.get("/api/app/calendar/calendars")
  ).json()) as CalendarRow[];
}

async function occurrence(request: APIRequestContext, eventId: string) {
  const list = (await (
    await request.get(
      `/api/app/calendar/occurrences?from=${START - 1}&to=${START + 3_600_001}`,
    )
  ).json()) as OccurrenceRow[];
  return list.find((o) => o.eventId === eventId);
}

async function memberId(request: APIRequestContext): Promise<string> {
  const users = (await (await request.get("/api/app/users")).json()) as {
    id: string;
    email: string;
  }[];
  return users.find((u) => u.email === MEMBER.email)!.id;
}

test.describe("calendar sharing", () => {
  test("a shared calendar is read-only, in the viewer's own colour", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const owner = page.request;
    const family = (await (
      await owner.post("/api/app/calendar/calendars", {
        data: { name: "Family", color: "#16a085" },
      })
    ).json()) as CalendarRow;
    const event = (await (
      await owner.post("/api/app/calendar/events", {
        data: { title: "Grandma visits", calendarId: family.id, ...SPAN },
      })
    ).json()) as { id: string };
    const member = await memberId(owner);
    const shared = await owner.put(`/api/app/calendar/calendars/${family.id}`, {
      data: { sharedWith: [member] },
    });
    expect(((await shared.json()) as CalendarRow).sharedWith).toEqual([member]);

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    await signIn(memberPage, MEMBER);
    const viewer = memberPage.request;
    expect((await calendars(viewer)).find((c) => c.id === family.id)).toMatchObject({
      access: "viewer",
      color: "#16a085",
    });
    expect(await occurrence(viewer, event.id)).toMatchObject({
      calendarId: family.id,
      color: "#16a085",
    });

    // The viewer's colour is theirs alone.
    await viewer.put(`/api/app/calendar/calendars/${family.id}`, {
      data: { color: "#c0392b" },
    });
    expect((await occurrence(viewer, event.id))?.color).toBe("#c0392b");
    expect((await occurrence(owner, event.id))?.color).toBe("#16a085");

    // Nothing else changes for a viewer.
    const read = (await (
      await viewer.get(`/api/app/calendar/events/${event.id}`)
    ).json()) as {
      access: string;
    };
    expect(read.access).toBe("read");
    expect(
      (
        await viewer.put(`/api/app/calendar/events/${event.id}`, {
          data: { title: "Mine now" },
        })
      ).status(),
    ).toBe(403);
    expect((await viewer.delete(`/api/app/calendar/events/${event.id}`)).status()).toBe(
      403,
    );
    expect(
      (
        await viewer.put(`/api/app/calendar/calendars/${family.id}`, {
          data: { name: "Ours" },
        })
      ).status(),
    ).toBe(403);

    // Leaving it hides it; the owner's calendar stays.
    expect((await viewer.delete(`/api/app/calendar/calendars/${family.id}`)).ok()).toBe(
      true,
    );
    expect(await occurrence(viewer, event.id)).toBeUndefined();
    expect(await occurrence(owner, event.id)).toBeDefined();
    await context.close();
  });

  test("an event shared with you shows in the calendar you choose", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const owner = page.request;
    const member = await memberId(owner);
    const event = (await (
      await owner.post("/api/app/calendar/events", {
        data: { title: "School play", sharedWith: [member], ...SPAN },
      })
    ).json()) as { id: string };

    const context = await browser.newContext();
    const memberPage = await context.newPage();
    await signIn(memberPage, MEMBER);
    const viewer = memberPage.request;
    const mine = await calendars(viewer);
    const memberDefault = mine.find((c) => c.isDefault)!;
    expect(await occurrence(viewer, event.id)).toMatchObject({
      calendarId: memberDefault.id,
      color: memberDefault.color,
    });

    // A calendar for shared events takes it in its colour.
    const inbox = (await (
      await viewer.post("/api/app/calendar/calendars", {
        data: { name: "From others", color: "#d9822b" },
      })
    ).json()) as CalendarRow;
    await viewer.put(`/api/app/calendar/calendars/${inbox.id}`, {
      data: { receivesShared: true },
    });
    expect(await occurrence(viewer, event.id)).toMatchObject({
      calendarId: inbox.id,
      color: "#d9822b",
    });

    // Placed elsewhere, it stays there when the owner edits it.
    const kids = (await (
      await viewer.post("/api/app/calendar/calendars", {
        data: { name: "Kids", color: "#8e44ad" },
      })
    ).json()) as CalendarRow;
    const placed = await viewer.put(`/api/app/calendar/events/${event.id}/placement`, {
      data: { calendarId: kids.id },
    });
    expect(((await placed.json()) as { shownIn: string }).shownIn).toBe(kids.id);
    await owner.put(`/api/app/calendar/events/${event.id}`, {
      data: { title: "School play (Act 2)", sharedWith: [member] },
    });
    expect(await occurrence(viewer, event.id)).toMatchObject({
      calendarId: kids.id,
      color: "#8e44ad",
      title: "School play (Act 2)",
    });
    // The owner still sees it in their own calendar's colour.
    expect((await occurrence(owner, event.id))?.calendarId).not.toBe(kids.id);

    // Removing that calendar sends it back to the one for shared events.
    await viewer.delete(`/api/app/calendar/calendars/${kids.id}`);
    expect((await occurrence(viewer, event.id))?.calendarId).toBe(inbox.id);
    await context.close();
  });
});
