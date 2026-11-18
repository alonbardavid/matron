import { expect, test } from "@playwright/test";
import { runTestSql } from "../../test-db";
import { signIn } from "../helpers";
import { OWNER } from "../users";

const BRANCH_ID = "BR_e2eBuildStart";
const TITLE = "Recipes for the week";
const ARCHIVED_NOTICE = "This session is archived";
const SESSIONS_ON_BRANCH = `/api/arch/sessions?branch=${BRANCH_ID}`;

test.describe("starting a build", () => {
  test("a new build starts from main only, and Build never opens a merged branch's session", async ({
    page,
  }) => {
    // The branch is put into the test database by wrangler, which takes a while.
    test.slow();
    await signIn(page, OWNER);
    const created = await page.request.post("/api/arch/sessions", { data: {} });
    expect(created.ok()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };
    // No request of a test deploys a branch: the session is given its live branch directly.
    runTestSql([
      `UPDATE build_sessions SET title = '${TITLE}', status = 'deployed' WHERE id = '${id}'`,
      `INSERT INTO branches (id, name, preview_name, build_session_id, user_id, base_commit, status)
       SELECT '${BRANCH_ID}', 'recipes', 'recipes-e2e', id, user_id, 'e2e', 'ready'
       FROM build_sessions WHERE id = '${id}'`,
    ]);
    const panel = page.locator(".mantine-Drawer-content");
    const newBuild = page.getByRole("button", { name: "New build" });
    const build = page.getByRole("button", { name: "Build", exact: true });
    try {
      // On the live branch the server starts no session, and the page offers none.
      const refused = await page.request.post(SESSIONS_ON_BRANCH, { data: {} });
      expect(refused.status()).toBe(409);
      await page.goto(`/builds?branch=${BRANCH_ID}`);
      await expect(newBuild).toBeDisabled();
      // Build is the branch's own chat.
      await build.click();
      await expect(panel.getByText(TITLE)).toBeVisible();
      await expect(panel.getByPlaceholder("Describe the change you want")).toBeEnabled();
      await page.keyboard.press("Escape");

      // The branch is merged while the tab stays on it.
      runTestSql([
        `UPDATE branches SET status = 'merged', archived_at = 1 WHERE id = '${BRANCH_ID}'`,
        `UPDATE build_sessions SET status = 'merged', archived_at = 1 WHERE id = '${id}'`,
      ]);
      await page.reload();
      await expect(newBuild).toBeEnabled();
      // Build opens a chat that can be continued, never the merged branch's.
      await build.click();
      await expect(panel.getByPlaceholder("Describe the change you want")).toBeEnabled();
      await expect(panel.getByText(TITLE)).toBeHidden();
      await expect(panel.getByText(ARCHIVED_NOTICE)).toBeHidden();
      // A branch that is gone holds no new session back.
      const allowed = await page.request.post(SESSIONS_ON_BRANCH, { data: {} });
      expect(allowed.ok()).toBeTruthy();
      const extra = (await allowed.json()) as { id: string };
      await page.request.post(`/api/arch/sessions/${extra.id}/archive`);
    } finally {
      // Nothing of the branch is left for the tests that list branches.
      runTestSql([
        `DELETE FROM branches WHERE id = '${BRANCH_ID}'`,
        `UPDATE build_sessions SET archived_at = 1 WHERE id = '${id}'`,
      ]);
    }
  });
});
