import { expect, test, type Page } from "@playwright/test";
import { runTestSql } from "../../test-db";
import { signIn } from "../helpers";
import { OWNER } from "../users";

const ARCHIVED_NOTICE = "This session is archived";
const COMPOSER = "Describe the change you want";

/** A session of the signed-in user's, made as the app makes one, from main. */
async function createSession(page: Page): Promise<string> {
  const created = await page.request.post("/api/arch/sessions", { data: {} });
  expect(created.ok()).toBeTruthy();
  return ((await created.json()) as { id: string }).id;
}

/**
 * No request of a test deploys a branch: the session is given its branch
 * directly, and made the one touched last.
 */
function deployBranch(
  sessionId: string,
  branch: { id: string; name: string; title: string; status: string },
): void {
  runTestSql([
    `UPDATE build_sessions
     SET title = '${branch.title}', status = 'deployed', updated_at = updated_at + 3600000
     WHERE id = '${sessionId}'`,
    `INSERT INTO branches (id, name, preview_name, build_session_id, user_id, base_commit, status)
     SELECT '${branch.id}', '${branch.name}', '${branch.name}-e2e', id, user_id, 'e2e', '${branch.status}'
     FROM build_sessions WHERE id = '${sessionId}'`,
  ]);
}

test.describe("starting a build", () => {
  test("on a branch Build is that branch's session, merged or not, and no new build starts there", async ({
    page,
  }) => {
    // The branch is put into the test database by wrangler, which takes a while.
    test.slow();
    const branch = {
      id: "BR_e2eOnBranch",
      name: "recipes",
      title: "Recipes for the week",
      status: "ready",
    };
    const sessionsOnBranch = `/api/arch/sessions?branch=${branch.id}`;
    await signIn(page, OWNER);
    const id = await createSession(page);
    deployBranch(id, branch);
    const panel = page.locator(".mantine-Drawer-content");
    const newBuild = page.getByRole("button", { name: "New build" });
    const build = page.getByRole("button", { name: "Build", exact: true });
    try {
      // On the branch the server starts no session, and the page offers none.
      const refused = await page.request.post(sessionsOnBranch, { data: {} });
      expect(refused.status()).toBe(409);
      await page.goto(`/builds?branch=${branch.id}`);
      await expect(newBuild).toBeDisabled();
      // Build is the branch's own chat.
      await build.click();
      await expect(panel.getByText(branch.title)).toBeVisible();
      await expect(panel.getByPlaceholder(COMPOSER)).toBeEnabled();
      await page.keyboard.press("Escape");

      // The branch is merged while the tab stays on it: the chat is still the branch's, to read.
      runTestSql([
        `UPDATE branches SET status = 'merged', archived_at = 1 WHERE id = '${branch.id}'`,
        `UPDATE build_sessions SET status = 'merged', archived_at = 1 WHERE id = '${id}'`,
      ]);
      await page.reload();
      await expect(newBuild).toBeDisabled();
      await build.click();
      await expect(panel.getByText(branch.title)).toBeVisible();
      await expect(panel.getByText(ARCHIVED_NOTICE)).toBeVisible();
      const stillRefused = await page.request.post(sessionsOnBranch, { data: {} });
      expect(stillRefused.status()).toBe(409);
    } finally {
      // Nothing of the branch is left for the tests that list branches.
      runTestSql([
        `DELETE FROM branches WHERE id = '${branch.id}'`,
        `UPDATE build_sessions SET archived_at = 1 WHERE id = '${id}'`,
      ]);
    }
  });

  test("on main Build passes over a session whose branch is being abandoned", async ({
    page,
  }) => {
    test.slow();
    const branch = {
      id: "BR_e2eClosing",
      name: "curtains",
      title: "Curtains for the hall",
      status: "abandoning",
    };
    await signIn(page, OWNER);
    const id = await createSession(page);
    // The latest session by far, and still open: only its branch says it is on its way out.
    deployBranch(id, branch);
    try {
      const listed = await page.request.get("/api/arch/sessions");
      const sessions = (await listed.json()) as {
        id: string;
        closing: boolean;
        archivedAt: number | null;
      }[];
      expect(sessions.find((session) => session.id === id)).toMatchObject({
        closing: true,
        archivedAt: null,
      });
      await page.goto("/builds");
      await page.getByRole("button", { name: "Build", exact: true }).click();
      // A chat that can be continued, and not that session's.
      const panel = page.locator(".mantine-Drawer-content");
      await expect(panel.getByPlaceholder(COMPOSER)).toBeEnabled();
      await expect(panel.getByText(branch.title)).toBeHidden();
    } finally {
      runTestSql([
        `DELETE FROM branches WHERE id = '${branch.id}'`,
        `UPDATE build_sessions SET archived_at = 1 WHERE id = '${id}'`,
      ]);
    }
  });
});
