import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

interface EventRow {
  id: string;
  attendees: string[];
  replies: Record<string, string>;
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

test.describe("guest replies", () => {
  test("each guest answers for themselves, and answers outlive changes to the guest list", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const ids = await idsOf(page);
    const start = Date.UTC(2031, 9, 7, 18);
    const event = (await (
      await page.request.post("/api/app/calendar/events", {
        data: {
          title: "Dinner at Gran's",
          allDay: false,
          startAt: start,
          endAt: start + 7_200_000,
          timeZone: "UTC",
          sharedWith: [ids.member],
        },
      })
    ).json()) as EventRow;
    // Whoever made it is going; the guest has yet to say.
    expect(event.replies).toEqual({
      [ids.owner]: "accepted",
      [ids.member]: "needs_action",
    });

    const member = await memberPage(browser);
    try {
      const answered = await member.page.request.put(
        `/api/app/calendar/events/${event.id}/reply`,
        { data: { response: "declined" } },
      );
      expect(((await answered.json()) as EventRow).replies[ids.member]).toBe("declined");
      const occurrences = (await (
        await member.page.request.get(
          `/api/app/calendar/occurrences?from=${start - 1}&to=${start + 1}`,
        )
      ).json()) as { eventId: string; response: string | null }[];
      expect(occurrences.find((o) => o.eventId === event.id)?.response).toBe("declined");
    } finally {
      await member.close();
    }

    // The owner changes the guest list; the answer stays.
    const updated = await page.request.put(`/api/app/calendar/events/${event.id}`, {
      data: { sharedWith: [ids.member], attendees: [ids.owner, ids.member] },
    });
    expect(((await updated.json()) as EventRow).replies[ids.member]).toBe("declined");

    // Someone it was never shared with cannot answer it.
    const mine = (await (
      await page.request.post("/api/app/calendar/events", {
        data: {
          title: "Private",
          allDay: false,
          startAt: start,
          endAt: start + 3_600_000,
          timeZone: "UTC",
        },
      })
    ).json()) as EventRow;
    const outsider = await memberPage(browser);
    try {
      const refused = await outsider.page.request.put(
        `/api/app/calendar/events/${mine.id}/reply`,
        { data: { response: "accepted" } },
      );
      expect(refused.status()).toBe(404);
    } finally {
      await outsider.close();
    }
  });

  test("a guest says no from the dialog, and the event is crossed out for them", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER);
    const ids = await idsOf(page);
    await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Parents' meeting",
        allDay: false,
        startAt: todayAt(19),
        endAt: todayAt(20),
        timeZone: "UTC",
        sharedWith: [ids.member],
      },
    });
    const member = await memberPage(browser);
    try {
      const event = member.page.locator("[data-event-id]", {
        hasText: "Parents' meeting",
      });
      await event.first().click();
      const dialog = member.page.getByRole("dialog");
      await dialog.getByText("No", { exact: true }).click();
      await expect(
        dialog.getByRole("listitem", { name: "Max Member" }).getByText("Not going"),
      ).toBeVisible();
      await member.page.keyboard.press("Escape");
      await expect(event.first()).toHaveAttribute("data-struck", "true");
    } finally {
      await member.close();
    }
  });
});
