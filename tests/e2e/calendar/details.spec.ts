import { expect, test } from "@playwright/test";
import { signIn } from "../helpers";
import { OWNER } from "../users";

interface EventRow {
  id: string;
  location: string;
  exceptions: { originalStartAt: number; location: string | null }[];
}

/** Location metadata as Google's place details give it, kept with the event it was picked for. */
const LOCATION_METADATA = {
  id: "p1",
  name: "Leisure Centre",
  address: "Mill Road, Cambridge CB1 2AD, UK",
  latitude: 52.1983,
  longitude: 0.1427,
  mapsUrl: "https://maps.google.com/?cid=123",
};

test.describe("location", () => {
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

  test("a new event takes a location", async ({ page }) => {
    await signIn(page, OWNER);
    await page.getByRole("button", { name: "New event" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Swimming gala");
    await dialog.getByLabel("Location").fill("Leisure Centre, Mill Road");
    await expect(dialog.getByRole("link", { name: "Open in Maps" })).toHaveAttribute(
      "href",
      /maps\/search\/\?api=1&query=Leisure%20Centre%2C%20Mill%20Road/,
    );
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
    // It opens as it reads: where it is.
    await expect(dialog.getByText("Leisure Centre, Mill Road")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open in Maps" })).toBeVisible();
    await dialog.getByRole("button", { name: "Edit event" }).click();
    await expect(dialog.getByLabel("Location")).toHaveValue("Leisure Centre, Mill Road");
  });

  test("a location keeps the metadata it was picked with, until it is typed over", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const start = Date.UTC(2031, 9, 7, 9);
    const created = await page.request.post("/api/app/calendar/events", {
      data: {
        title: "Dentist",
        location: "Smile Clinic, High St",
        locationMetadata: LOCATION_METADATA,
        allDay: false,
        startAt: start,
        endAt: start + 3_600_000,
        timeZone: "UTC",
        rrule: "FREQ=WEEKLY;COUNT=2",
      },
    });
    const event = (await created.json()) as EventRow & { locationMetadata: unknown };
    expect(event.locationMetadata).toEqual(LOCATION_METADATA);
    const update = (data: object) =>
      page.request
        .put(`/api/app/calendar/events/${event.id}`, { data })
        .then(
          (r) => r.json() as Promise<{ location: string; locationMetadata: unknown }>,
        );
    // Changing anything but the location keeps its metadata.
    expect((await update({ title: "Dentist (Sam)" })).locationMetadata).toEqual(
      LOCATION_METADATA,
    );
    // An occurrence of its own keeps its own metadata; the others the series'.
    const second = start + 7 * 86_400_000;
    const other = { ...LOCATION_METADATA, id: "p2", name: "Town Hall" };
    await page.request.put(`/api/app/calendar/events/${event.id}/occurrences/${second}`, {
      data: { location: "Town Hall", locationMetadata: other },
    });
    const list = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${start - 1}&to=${start + 14 * 86_400_000}`,
      )
    ).json()) as { eventId: string; locationMetadata: { id: string } | null }[];
    expect(
      list.filter((o) => o.eventId === event.id).map((o) => o.locationMetadata?.id),
    ).toEqual(["p1", "p2"]);
    // A location typed has no metadata.
    const typed = await update({ location: "Smile Clinic, room 4" });
    expect(typed).toMatchObject({
      location: "Smile Clinic, room 4",
      locationMetadata: null,
    });
  });

  test("Google suggests places for a location once the household set up Places", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    // Local dev holds no Places key: nothing is suggested, and Google is not asked.
    const none = await page.request.get(
      "/api/app/calendar/places?query=Mill%20Road&session=s1",
    );
    expect(await none.json()).toEqual({ available: false, places: [] });
    expect(
      (await page.request.get("/api/app/calendar/places/p1?session=s1")).status(),
    ).toBe(503);

    // With a key, the Worker answers with Google's places; stand in for it here.
    const asked: URL[] = [];
    await page.route("**/api/app/calendar/places?**", async (route) => {
      asked.push(new URL(route.request().url()));
      await route.fulfill({
        json: {
          available: true,
          places: [
            {
              id: LOCATION_METADATA.id,
              text: "Leisure Centre, Mill Road, Cambridge, UK",
              main: "Leisure Centre",
              secondary: "Mill Road, Cambridge, UK",
            },
          ],
        },
      });
    });
    const detailed: URL[] = [];
    await page.route(
      `**/api/app/calendar/places/${LOCATION_METADATA.id}?**`,
      async (route) => {
        detailed.push(new URL(route.request().url()));
        await route.fulfill({ json: LOCATION_METADATA });
      },
    );
    await page.getByRole("button", { name: "New event" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Swim club");
    const location = dialog.getByLabel("Location");
    await location.pressSequentially("Leisure");
    const option = page.getByRole("option", { name: /Leisure Centre/ });
    await expect(option).toContainText("Mill Road, Cambridge, UK");
    await option.click();
    await expect(location).toHaveValue("Leisure Centre, Mill Road, Cambridge, UK");
    // The pick asks for its metadata in the same search the suggestions were, and
    // the picked text is not looked up again.
    await expect.poll(() => detailed.length).toBe(1);
    await page.waitForTimeout(500);
    expect(asked.map((url) => url.searchParams.get("query"))).toEqual(["Leisure"]);
    expect(detailed[0]!.searchParams.get("session")).toBe(
      asked[0]!.searchParams.get("session"),
    );
    // The location opens as Google has it.
    await expect(dialog.getByRole("link", { name: "Open in Maps" })).toHaveAttribute(
      "href",
      LOCATION_METADATA.mapsUrl,
    );
    await dialog.getByRole("button", { name: "Add event" }).click();
    await expect(dialog).toBeHidden();
    const now = Date.now();
    const listed = (await (
      await page.request.get(
        `/api/app/calendar/occurrences?from=${now - 86_400_000}&to=${now + 2 * 86_400_000}`,
      )
    ).json()) as { title: string; location: string; locationMetadata: unknown }[];
    expect(listed.find((o) => o.title === "Swim club")).toMatchObject({
      location: "Leisure Centre, Mill Road, Cambridge, UK",
      locationMetadata: LOCATION_METADATA,
    });

    // A link is not looked up.
    await page.getByRole("button", { name: "New event" }).click();
    const before = asked.length;
    await dialog.getByLabel("Location").fill("https://meet.example.com/abc");
    await page.waitForTimeout(500);
    expect(asked.length).toBe(before);
  });
});
