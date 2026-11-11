import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../helpers";
import { MEMBER, OWNER } from "../users";
import { BRANCH_ID, REVIEW } from "./fixture";

const REVIEW_PATH = `/branches/${BRANCH_ID}/review`;

/** Serves the fixture for the branch's review and a canned answer for questions about it. */
async function serveReview(page: Page) {
  await page.route(`**/api/arch/branches/${BRANCH_ID}/review`, (route) =>
    route.fulfill({ json: REVIEW }),
  );
  await page.route(`**/api/arch/branches/${BRANCH_ID}/review/ask`, async (route) => {
    const body = route.request().postDataJSON() as { messages: { text: string }[] };
    await route.fulfill({
      json: {
        text: `Answering question ${body.messages.length}: it is in \`clearBought\`.\n\n\`\`\`ts\nexport async function clearBought() {}\n\`\`\``,
      },
    });
  });
}

test.describe("branch review", () => {
  test("the owner reads the summary, the brackets and the files, and marks them viewed", async ({
    page,
  }) => {
    await signIn(page, OWNER);
    await serveReview(page);
    await page.evaluate(() => localStorage.clear());
    await page.goto(REVIEW_PATH);

    await expect(
      page.getByRole("heading", { name: "Add a shopping list to the tasks page" }),
    ).toBeVisible();
    await expect(page.getByText("Shopping items are tasks with")).toBeVisible();
    await expect(page.getByText("Can we have a shopping list?")).toBeVisible();

    await page.getByRole("tab", { name: /Brackets/ }).click();
    const brackets = page.getByRole("navigation", { name: "Brackets" });
    // The builder's two brackets, then what they left out: the test and the lockfile.
    await expect(brackets.getByRole("button")).toHaveCount(3);
    await expect(brackets.getByText("Not in a bracket")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Clearing bought items" }),
    ).toBeVisible();
    await expect(page.getByText("export async function clearBought")).toBeVisible();
    await page.getByRole("button", { name: /Mark bracket viewed/ }).click();
    await expect(brackets.getByRole("button").first()).toContainText("viewed");

    await brackets.getByRole("button", { name: /The list column/ }).click();
    await expect(page).toHaveURL(/bracket=2/);
    await expect(page.getByText("CREATE INDEX tasks_list")).toBeVisible();

    await page.getByRole("tab", { name: /Files/ }).click();
    const tree = page.getByRole("navigation", { name: "File tree" });
    await tree.getByRole("button", { name: /shopping\.spec\.ts/ }).click();
    await expect(page).toHaveURL(/file=tests%2Fe2e%2Ftasks%2Fshopping\.spec\.ts/);
    await expect(page.getByRole("article")).toContainText("Clear bought");
    await page.getByRole("checkbox", { name: "Viewed", exact: true }).check();
    await expect(tree.getByRole("img", { name: "Viewed", exact: true })).toHaveCount(3);

    // The marks are kept in the browser, per branch.
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "Viewed", exact: true }),
    ).toBeChecked();
    // A line's rail marks its change; a shift-click takes in every change since the last click.
    await tree.getByRole("button", { name: /0007_task_lists\.sql/ }).click();
    await expect(page.getByRole("article")).toContainText("CREATE INDEX");
    await page.getByRole("checkbox", { name: /^Mark line 1 viewed/ }).click();
    await page
      .getByRole("checkbox", { name: /^Mark line 3 viewed/ })
      .click({ modifiers: ["Shift"] });
    await expect(
      page.getByRole("checkbox", { name: "Unmark these 3 changes viewed" }),
    ).toBeChecked();
    await expect(tree.getByRole("img", { name: "Viewed", exact: true })).toHaveCount(4);
    await tree.getByRole("button", { name: "pnpm-lock.yaml" }).click();
    await expect(page.getByText("A generated file")).toBeVisible();
  });

  test("the owner asks about the branch", async ({ page }) => {
    await signIn(page, OWNER);
    await serveReview(page);
    await page.goto(REVIEW_PATH);
    await page.getByRole("button", { name: "Ask about the code" }).click();
    await page.getByLabel("Question").fill("Where are bought items cleared?");
    await page.getByLabel("Question").press("Enter");
    await expect(page.getByText("Answering question 1: it is in")).toBeVisible();
    await expect(
      page.getByText("Where are bought items cleared?", { exact: true }),
    ).toBeVisible();
    // A fenced block in the answer is coloured by its language.
    await expect(page.locator("pre .hljs-keyword", { hasText: "async" })).toBeVisible();
  });

  test("the owner reads a diff unified or split, in colour", async ({ page }) => {
    await signIn(page, OWNER);
    await serveReview(page);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${REVIEW_PATH}?tab=files&file=backend%2Ftasks%2Fsrc%2Fservice.ts`);
    const diff = page.getByRole("article");
    await expect(diff).toContainText("clearBought");
    await expect(
      diff.locator(".hljs-keyword", { hasText: "export" }).first(),
    ).toBeVisible();
    await expect(
      diff.locator(".hljs-string", { hasText: '"view"' }).first(),
    ).toBeVisible();

    // Unified: the replaced signature and its replacement are separate rows.
    const replaced = diff
      .getByRole("row")
      .filter({ hasText: "listTasks(principal: Principal) {" })
      .filter({ hasText: "list?: string" });
    await expect(replaced).toHaveCount(0);

    const layoutSwitch = page.getByRole("radiogroup", { name: "Diff layout" });
    // Split: the line before sits beside the line that replaced it, still one change.
    await layoutSwitch.getByText("Split", { exact: true }).click();
    await expect(replaced).toHaveCount(1);
    await replaced.getByRole("checkbox", { name: /^Mark line 6 viewed/ }).click();
    await expect(
      replaced.getByRole("checkbox", { name: /^Unmark line 6 viewed/ }),
    ).toBeChecked();

    // The layout is remembered in this browser.
    await page.reload();
    await expect(replaced).toHaveCount(1);
    await layoutSwitch.getByText("Unified", { exact: true }).click();
    await expect(replaced).toHaveCount(0);
  });

  test("a branch the repository does not know answers not found", async ({ page }) => {
    await signIn(page, OWNER);
    const answer = await page.request.get(`/api/arch/branches/${BRANCH_ID}/review`);
    expect(answer.status()).toBe(404);
  });

  test("a member cannot review", async ({ page }) => {
    await signIn(page, MEMBER);
    const answer = await page.request.get(`/api/arch/branches/${BRANCH_ID}/review`);
    expect(answer.status()).toBe(403);
    await page.goto(REVIEW_PATH);
    await expect(page.getByRole("heading", { name: "Calendar", level: 2 })).toBeVisible();
  });
});
