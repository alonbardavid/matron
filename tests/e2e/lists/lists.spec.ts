import { expect, test, type Page } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";

interface Item {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  createdAt: number;
}

async function makeList(page: Page, data: Record<string, unknown>) {
  const made = await page.request.post("/api/app/lists", { data });
  expect(made.ok()).toBeTruthy();
  return (await made.json()) as { id: string };
}

async function addItem(page: Page, listId: string, data: Record<string, unknown>) {
  const added = await page.request.post(`/api/app/lists/${listId}/items`, { data });
  expect(added.ok()).toBeTruthy();
  return (await added.json()) as { id: string };
}

/** The list's items as an outline: titles in order, each one's items in brackets after it. */
async function outlineOf(page: Page, listId: string): Promise<string> {
  const list = (await (await page.request.get(`/api/app/lists/${listId}`)).json()) as {
    items: Item[];
  };
  const under = (parentId: string | null): string =>
    list.items
      .filter((item) => item.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
      .map((item) => {
        const inner = under(item.id);
        return inner ? `${item.title} [${inner}]` : item.title;
      })
      .join(", ");
  return under(null);
}

async function memberIdOf(page: Page): Promise<string> {
  const users = (await (await page.request.get("/api/app/users")).json()) as {
    id: string;
    email: string;
  }[];
  return users.find((u) => u.email === MEMBER.email)!.id;
}

test.describe("lists", () => {
  test("make a list, add, tick off, edit and remove its items", async ({ page }) => {
    await signIn(page, OWNER);
    await navLink(page, "Lists").click();
    await expect(page.getByRole("heading", { name: "Lists" })).toBeVisible();

    await page.getByRole("button", { name: "New list" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await dialog.getByLabel("Name").fill("Weekend chores");
    await dialog.getByRole("button", { name: "Make list" }).click();
    // Made, it opens.
    await expect(page.getByRole("heading", { name: "Weekend chores" })).toBeVisible();
    await expect(page.getByText("Only you")).toBeVisible();

    const add = page.getByRole("textbox", { name: "Add an item to Weekend chores" });
    await add.fill("Buy milk");
    await add.press("Enter");
    await add.fill("Fix the shelf");
    await add.press("Enter");
    await expect(page.getByRole("checkbox", { name: "Buy milk" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Fix the shelf" })).toBeVisible();

    // Ticked off, it goes to the completed section, folded away.
    // Ticked off, the box leaves the open items at once: a click, not a check.
    await page.getByRole("checkbox", { name: "Buy milk" }).click();
    const completed = page.getByRole("region", { name: "Completed" });
    await completed.getByRole("button", { name: "1 completed" }).click();
    await expect(completed.getByRole("checkbox", { name: "Buy milk" })).toBeChecked();

    await page.getByRole("button", { name: "Fix the shelf", exact: true }).click();
    await dialog.getByLabel("Title").fill("Fix the bookshelf");
    // Enter in a field submits the form.
    await dialog.getByLabel("Title").press("Enter");
    await expect(page.getByRole("checkbox", { name: "Fix the bookshelf" })).toBeVisible();

    await page.getByRole("button", { name: "Fix the bookshelf", exact: true }).click();
    await dialog.getByRole("button", { name: "Remove" }).click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Remove this item and everything under it?" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(page.getByRole("checkbox", { name: "Fix the bookshelf" })).toHaveCount(
      0,
    );

    // Back on the Lists page, the list is a card that opens it.
    await page.getByRole("link", { name: "All lists" }).click();
    const card = page.locator("[data-list-card='Weekend chores']");
    await expect(card).toContainText("+ 1 completed");
    await card.getByRole("link", { name: "Weekend chores" }).click();
    await expect(page.getByRole("heading", { name: "Weekend chores" })).toBeVisible();
  });

  test("items keep their order and nest by dragging", async ({ page }) => {
    await signIn(page, OWNER);
    const list = await makeList(page, { name: "Party" });
    for (const title of ["Venue", "Invitations", "Cake", "Flavour"]) {
      await addItem(page, list.id, { title });
    }
    await page.goto(`/lists/${list.id}`);
    await expect(page.getByRole("checkbox", { name: "Flavour" })).toBeVisible();
    const row = (title: string) => page.locator(`[data-item-row='${title}']`);
    /** Drags the item by its handle: down to a point in another row, or sideways. */
    const drag = async (title: string, to: { below?: string; dx?: number }) => {
      const from = (await page
        .getByRole("button", { name: `Drag ${title}` })
        .boundingBox())!;
      const x = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      const target = to.below ? (await row(to.below).boundingBox())! : null;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(
        x + (to.dx ?? 0),
        target ? target.y + target.height * 0.9 : y,
        { steps: 10 },
      );
      await page.mouse.up();
    };

    // Down past two items.
    await drag("Venue", { below: "Cake" });
    await expect
      .poll(() => outlineOf(page, list.id))
      .toBe("Invitations, Cake, Venue, Flavour");
    // Right: under the item above.
    await drag("Venue", { dx: 40 });
    await expect
      .poll(() => outlineOf(page, list.id))
      .toBe("Invitations, Cake [Venue], Flavour");
    // An item under another moves with it.
    await drag("Cake", { below: "Flavour" });
    await expect
      .poll(() => outlineOf(page, list.id))
      .toBe("Invitations, Flavour, Cake [Venue]");
    // Left: out a level again.
    await drag("Venue", { dx: -40 });
    await expect
      .poll(() => outlineOf(page, list.id))
      .toBe("Invitations, Flavour, Cake, Venue");
  });

  test("an item's menu edits it, adds an item under it and deletes it", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const list = await makeList(page, { name: "Garage" });
    await addItem(page, list.id, { title: "Sell the bike" });
    await page.goto(`/lists/${list.id}`);
    const menu = async (title: string, action: string) => {
      await page.getByRole("button", { name: `Options for ${title}` }).click();
      await expect(page.getByRole("menuitem")).toHaveText([
        "Edit",
        "Add a subitem",
        "Delete",
      ]);
      await page.getByRole("menuitem", { name: action }).click();
    };
    const dialog = page.getByRole("dialog");

    await menu("Sell the bike", "Edit");
    await dialog.getByLabel("Title").fill("Sell the old bike");
    await dialog.getByLabel("Title").press("Enter");
    await expect(page.getByRole("checkbox", { name: "Sell the old bike" })).toBeVisible();

    await menu("Sell the old bike", "Add a subitem");
    await expect(dialog.getByText("Under “Sell the old bike”")).toBeVisible();
    await dialog.getByLabel("Title").fill("Take photos");
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect
      .poll(() => outlineOf(page, list.id))
      .toBe("Sell the old bike [Take photos]");

    await menu("Sell the old bike", "Delete");
    const confirm = page.getByRole("dialog", { name: "Delete item" });
    await expect(confirm).toContainText(
      "Delete “Sell the old bike” and everything under it?",
    );
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => outlineOf(page, list.id)).toBe("");
    await expect(page.getByRole("checkbox", { name: "Take photos" })).toHaveCount(0);
  });

  test("an item moves to another list with the items under it", async ({ page }) => {
    await signIn(page, OWNER);
    const home = await makeList(page, { name: "Home" });
    const garden = await makeList(page, { name: "Garden" });
    const shed = await addItem(page, home.id, { title: "Tidy the shed" });
    await addItem(page, home.id, { title: "Sort the tools", parentId: shed.id });
    await addItem(page, garden.id, { title: "Plant bulbs" });
    // The assistant moves items between lists; the page does not offer it.
    const moved = await page.request.put(`/api/app/list-items/${shed.id}/position`, {
      data: { listId: garden.id, parentId: null, index: 1 },
    });
    expect(moved.ok()).toBeTruthy();
    expect(await outlineOf(page, garden.id)).toBe(
      "Plant bulbs, Tidy the shed [Sort the tools]",
    );
    expect(await outlineOf(page, home.id)).toBe("");
  });

  test("a list is shared to view, edit or share", async ({ page, browser }) => {
    await signIn(page, OWNER);
    const memberId = await memberIdOf(page);
    const list = await makeList(page, { name: "Groceries", sharedWith: [memberId] });
    await addItem(page, list.id, { title: "Eggs" });
    const secret = await makeList(page, { name: "Surprise party" });

    const other = await browser.newContext();
    const theirs = await other.newPage();
    try {
      await signIn(theirs, MEMBER);
      // A list not shared with them is not there for them.
      expect((await theirs.request.get(`/api/app/lists/${secret.id}`)).status()).toBe(
        404,
      );

      // Shared to view: seen, not changed.
      await theirs.goto(`/lists/${list.id}`);
      await expect(theirs.getByRole("heading", { name: "Groceries" })).toBeVisible();
      await expect(theirs.getByText(`Shared with you by ${OWNER.name}`)).toBeVisible();
      await expect(theirs.getByText("View only")).toBeVisible();
      await expect(theirs.getByRole("checkbox", { name: "Eggs" })).toBeDisabled();
      await expect(theirs.getByRole("textbox", { name: /Add an item/ })).toHaveCount(0);
      const tryAdd = await theirs.request.post(`/api/app/lists/${list.id}/items`, {
        data: { title: "Crisps" },
      });
      expect(tryAdd.status()).toBe(403);
      const tryShare = await theirs.request.put(`/api/app/lists/${list.id}`, {
        data: { sharedWith: [] },
      });
      expect(tryShare.status()).toBe(403);

      // Given edit, from the list's settings: they add items.
      await page.goto(`/lists/${list.id}`);
      await page.getByRole("button", { name: "List options" }).click();
      await page.getByRole("menuitem", { name: "Name, colour and sharing" }).click();
      const settings = page.getByRole("dialog");
      await settings.getByRole("checkbox", { name: `${MEMBER.name} may edit` }).check();
      await settings.getByRole("button", { name: "Save" }).click();
      await expect(settings).toHaveCount(0);
      await theirs.reload();
      const add = theirs.getByRole("textbox", { name: "Add an item to Groceries" });
      await add.fill("Crisps");
      await add.press("Enter");
      await expect(theirs.getByRole("checkbox", { name: "Crisps" })).toBeVisible();
      // Editing is not sharing.
      const stillNoShare = await theirs.request.put(`/api/app/lists/${list.id}`, {
        data: { sharedWith: [] },
      });
      expect(stillNoShare.status()).toBe(403);
      // Nor do they remove a list they did not make.
      expect((await theirs.request.delete(`/api/app/lists/${list.id}`)).status()).toBe(
        403,
      );

      // Given share, but taken off edit: they may share it, not make someone an editor.
      const share = await page.request.put(`/api/app/lists/${list.id}`, {
        data: { permissions: { [memberId]: ["share"] } },
      });
      expect(share.ok()).toBeTruthy();
      const giveEdit = await theirs.request.put(`/api/app/lists/${list.id}`, {
        data: { permissions: { [memberId]: ["share", "edit"] } },
      });
      expect(giveEdit.status()).toBe(403);
    } finally {
      await other.close();
    }
  });

  test("the lists page searches the lists and pins them on this device", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    const books = await makeList(page, { name: "Books to read" });
    await addItem(page, books.id, { title: "The Overstory" });
    const films = await makeList(page, { name: "Films to watch" });
    await addItem(page, films.id, { title: "Paddington 2" });
    await page.goto("/lists");
    const card = (name: string) => page.locator(`[data-list-card='${name}']`);
    await expect(card("Books to read")).toContainText("The Overstory");

    // A search finds a list by its name or by an item on it.
    const search = page.getByRole("searchbox", { name: "Search lists" });
    await search.fill("paddington");
    await expect(card("Films to watch")).toBeVisible();
    await expect(card("Books to read")).toHaveCount(0);
    await search.fill("");
    await expect(card("Books to read")).toBeVisible();

    // Pinned, it is at the top, and stays there on this device.
    await card("Films to watch")
      .getByRole("button", { name: "Pin on this device" })
      .click();
    const pinned = page.getByRole("region", { name: "Pinned" });
    await expect(pinned.locator("[data-list-card='Films to watch']")).toBeVisible();
    await page.reload();
    await expect(pinned.locator("[data-list-card='Films to watch']")).toBeVisible();
    await expect(pinned.locator("[data-list-card='Books to read']")).toHaveCount(0);
    await pinned
      .locator("[data-list-card='Films to watch']")
      .getByRole("button", { name: "Unpin from this device" })
      .click();
    await expect(pinned).toHaveCount(0);

    // An item is ticked off from its card; the rest of the card opens the list.
    await card("Books to read").getByRole("checkbox", { name: "The Overstory" }).click();
    await expect(card("Books to read")).toContainText("+ 1 completed");
    await expect(
      card("Books to read").getByRole("checkbox", { name: "The Overstory" }),
    ).toHaveCount(0);
    // The card's link lies over its text: a click there, as a finger's, opens the list.
    const text = (await card("Films to watch").getByText("Paddington 2").boundingBox())!;
    await page.mouse.click(text.x + text.width / 2, text.y + text.height / 2);
    await expect(page.getByRole("heading", { name: "Films to watch" })).toBeVisible();
  });

  test("a tick shows at once and goes back if the server refuses it", async ({ page }) => {
    await signIn(page, OWNER);
    const trip = await makeList(page, { name: "Trip" });
    const tent = await addItem(page, trip.id, { title: "Tent" });
    await addItem(page, trip.id, { title: "Pegs", parentId: tent.id });
    await addItem(page, trip.id, { title: "Poles", parentId: tent.id });
    await addItem(page, trip.id, { title: "Stove" });

    // Ticks are held until let go, then answered with a failure.
    const held: (() => Promise<void>)[] = [];
    await page.route("**/api/app/list-items/*", (route) =>
      route.request().method() === "PUT"
        ? held.push(() => route.fulfill({ status: 500, json: { message: "down" } }))
        : route.continue(),
    );

    await page.goto("/lists");
    const card = page.locator("[data-list-card='Trip']");
    await expect(card).toContainText("0/2");

    // An item under another: its line goes and its parent counts it done.
    await card.getByRole("checkbox", { name: "Pegs" }).click();
    await expect(card.getByRole("checkbox", { name: "Pegs" })).toHaveCount(0);
    await expect(card).toContainText("1/2");
    await expect(card).toContainText("+ 1 completed");
    // A top item: its line goes with those under it.
    await card.getByRole("checkbox", { name: "Tent" }).click();
    await expect(card.getByRole("checkbox", { name: "Poles" })).toHaveCount(0);
    await expect(card).toContainText("+ 2 completed");

    // The list's page, opened before the server has answered, shows both ticks.
    await card.getByRole("link", { name: "Trip" }).click();
    await expect(page.getByRole("heading", { name: "Trip" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Tent" })).toHaveCount(0);
    await expect(page.getByText("1 completed")).toBeVisible();

    // They go to the server one after the other; each refused goes back.
    await expect.poll(() => held.length).toBe(1);
    await held.splice(0)[0]!();
    await expect.poll(() => held.length).toBe(1);
    await held.splice(0)[0]!();
    await page.getByRole("link", { name: "All lists" }).click();
    await expect(card.getByRole("checkbox", { name: "Pegs" })).toBeVisible();
    await expect(card.getByRole("checkbox", { name: "Poles" })).toBeVisible();
    await expect(card).toContainText("0/2");
    await expect(card).not.toContainText("completed");

    // On the list's page, likewise: ticked, it goes to the folded completed items.
    await page.goto(`/lists/${trip.id}`);
    const stove = page.getByRole("checkbox", { name: "Stove" });
    await stove.click();
    await expect(stove).toHaveCount(0);
    await expect(page.getByText("1 completed")).toBeVisible();
    await expect.poll(() => held.length).toBe(1);
    await held.splice(0)[0]!();
    await expect(stove).not.toBeChecked();
    await expect(page.getByText("1 completed")).toHaveCount(0);
    expect(await outlineOf(page, trip.id)).toBe("Tent [Pegs, Poles], Stove");
  });
});
