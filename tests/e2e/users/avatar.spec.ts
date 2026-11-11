import { expect, test, type Page } from "@playwright/test";
import { navLink, signIn } from "../helpers";
import { MEMBER } from "../users";

// A 1x1 red PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

function pictureInput(page: Page) {
  return page.getByLabel("Picture file");
}

test.describe("avatar", () => {
  test("a member uploads a picture, everyone sees it, and removes it again", async ({
    page,
  }) => {
    await signIn(page, MEMBER);
    await navLink(page, "Settings").click();
    await expect(page.getByRole("button", { name: "Upload picture" })).toBeVisible();

    await pictureInput(page).setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(page.getByText("Picture saved")).toBeVisible();
    const picture = page.getByTestId("my-avatar").locator("img");
    await expect(picture).toBeVisible();
    const src = await picture.getAttribute("src");
    expect(src).toMatch(/^\/api\/app\/files\/FL_/);

    // Served as a JPEG, under the application, to a signed-in member.
    const served = await page.request.get(src!);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/jpeg");

    // The household list carries it for everyone's avatars.
    const users = await (await page.request.get("/api/app/users")).json();
    expect(users.find((u: { email: string }) => u.email === MEMBER.email).avatarUrl).toBe(
      src,
    );

    await page.getByRole("button", { name: "Remove picture" }).click();
    await expect(page.getByText("Picture removed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload picture" })).toBeVisible();
    expect((await page.request.get(src!)).status()).toBe(404);
  });

  test("a file that is not a picture is refused", async ({ page }) => {
    await signIn(page, MEMBER);
    await navLink(page, "Settings").click();
    await pictureInput(page).setInputFiles({
      name: "notes.png",
      mimeType: "image/png",
      buffer: Buffer.from("just text"),
    });
    await expect(page.getByText("Could not save the picture")).toBeVisible();
    await expect(
      page.getByText("The file is not a picture", { exact: false }),
    ).toBeVisible();
  });
});
