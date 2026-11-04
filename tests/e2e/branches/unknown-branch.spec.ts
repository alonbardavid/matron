import { expect, test } from "@playwright/test";
import { signIn } from "../helpers";
import { OWNER } from "../users";

// In development the page itself comes from Vite, so the router is reached
// through the API: it must refuse a branch that does not exist, never serve main.
test("a request naming a branch that does not exist is refused", async ({ page }) => {
  await signIn(page, OWNER);
  const api = await page.request.get("/api/app/tasks?branch=BR_doesNotExist");
  expect(api.status()).toBe(404);

  const navigation = await page.request.get("/api/app/tasks?branch=BR_doesNotExist", {
    headers: { "sec-fetch-mode": "navigate" },
  });
  expect(navigation.status()).toBe(404);
  expect(navigation.headers()["content-type"]).toContain("text/html");
  expect(await navigation.text()).toContain("This branch does not exist");

  const main = await page.request.get("/api/app/tasks");
  expect(main.status()).toBe(200);
});
