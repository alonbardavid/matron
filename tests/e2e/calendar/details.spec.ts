import { expect, test } from "@playwright/test";
import { signIn } from "../helpers";
import { OWNER } from "../users";

interface EventRow {
  id: string;
  location: string;
  attachments: { id: string; kind: string; title: string; url: string; source: string }[];
  exceptions: { originalStartAt: number; location: string | null }[];
}

test.describe("location and attachments", () => {
  test("an event has a location, one occurrence its own", async ({ page }) => {
    await signIn(page, OWNER);
    const start = Date.UTC(2031, 8, 2, 17);
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Choir",
        location: "  St Mary's Hall  ",
        allDay: false,
        startAt: start,
        endAt: start + 3_600_000,
        timeZone: "UTC",
        rrule: "FREQ=WEEKLY;COUNT=2",
      },
    });
    const event = (await created.json()) as EventRow;
    expect(event.location).toBe("St Mary's Hall");

    const second = start + 7 * 86_400_000;
    await page.request.put(`/api/app/calendar/events/${event.id}/occurrences/${second}`, {
      data: { location: "Town Hall" },
    });
    const list = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${start - 1}&to=${start + 14 * 86_400_000}`,
      )
    ).json()) as { eventId: string; location: string }[];
    expect(list.filter((o) => o.eventId === event.id).map((o) => o.location)).toEqual([
      "St Mary's Hall",
      "Town Hall",
    ]);
  });

  test("files and links attach to an event, and come off again", async ({ page }) => {
    await signIn(page, OWNER);
    const start = Date.UTC(2031, 8, 3, 9);
    const event = (await (
      await page.request.post("/api/app/calendar/events", {
        data: {
          title: "School trip",
          allDay: false,
          startAt: start,
          endAt: start + 3_600_000,
          timeZone: "UTC",
        },
      })
    ).json()) as EventRow;

    // Only web addresses.
    const bad = await page.request.post(
      `/api/app/calendar/events/${event.id}/attachments/links`,
      { data: { url: "javascript:alert(1)" } },
    );
    expect(bad.status()).toBe(400);
    const linked = await page.request.post(
      `/api/app/calendar/events/${event.id}/attachments/links`,
      { data: { url: "https://example.com/permission-slip" } },
    );
    expect(linked.ok()).toBeTruthy();
    expect(((await linked.json()) as EventRow).attachments[0]).toMatchObject({
      kind: "link",
      title: "example.com",
      url: "https://example.com/permission-slip",
      source: "matron",
    });

    // Only the types an event takes.
    const script = await page.request.post(
      `/api/app/calendar/events/${event.id}/attachments/files`,
      {
        multipart: {
          file: {
            name: "x.html",
            mimeType: "text/html",
            buffer: Buffer.from("<script>"),
          },
        },
      },
    );
    expect(script.status()).toBe(400);
    const uploaded = await page.request.post(
      `/api/app/calendar/events/${event.id}/attachments/files`,
      {
        multipart: {
          file: {
            name: "packing list.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("sandwiches, water"),
          },
        },
      },
    );
    expect(uploaded.ok()).toBeTruthy();
    const file = ((await uploaded.json()) as EventRow).attachments.find(
      (a) => a.kind === "file",
    )!;
    expect(file.title).toBe("packing list.txt");
    const served = await page.request.get(file.url);
    expect(await served.text()).toBe("sandwiches, water");

    const detached = await page.request.delete(
      `/api/app/calendar/events/${event.id}/attachments/${file.id}`,
    );
    expect(((await detached.json()) as EventRow).attachments.map((a) => a.kind)).toEqual([
      "link",
    ]);
    expect((await page.request.get(file.url)).status()).toBe(404);
  });

  test("a new event takes a location and a link before it is saved", async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole("button", { name: "New event" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Swimming gala");
    await dialog.getByLabel("Location").fill("Leisure Centre, Mill Road");
    await expect(dialog.getByRole("link", { name: "Open in Maps" })).toHaveAttribute(
      "href",
      /maps\/search\/\?api=1&query=Leisure%20Centre%2C%20Mill%20Road/,
    );
    await dialog.getByRole("button", { name: "Add link" }).click();
    await page.getByRole("textbox", { name: "Link" }).fill("https://example.com/gala");
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .last()
      .fill("Timetable");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add link" })).toBeHidden();
    await expect(dialog.getByText("added when saved")).toBeVisible();
    await dialog.getByRole("button", { name: "Add event" }).click();
    await expect(dialog).toBeHidden();
    // Wherever "the next hour" fell, put it where the week view shows it.
    const now = new Date();
    const ten = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10).getTime();
    const listed = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${ten - 2 * 86_400_000}&to=${ten + 2 * 86_400_000}`,
      )
    ).json()) as { eventId: string; title: string }[];
    const gala = listed.find((o) => o.title === "Swimming gala")!;
    await page.request.put(`/api/app/calendar/events/${gala.eventId}`, {
      data: { startAt: ten, endAt: ten + 3_600_000 },
    });
    await page.reload();

    await page.locator("[data-event-id]", { hasText: "Swimming gala" }).first().click();
    // It opens as it reads: where, and what is attached.
    await expect(dialog.getByText("Leisure Centre, Mill Road")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open in Maps" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Timetable" })).toHaveAttribute(
      "href",
      "https://example.com/gala",
    );
    await dialog.getByRole("button", { name: "Edit event" }).click();
    await expect(dialog.getByLabel("Location")).toHaveValue("Leisure Centre, Mill Road");
    // A file attaches at once to a saved event.
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "map.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
    await expect(dialog.getByRole("link", { name: "map.pdf" })).toBeVisible();
  });
});
