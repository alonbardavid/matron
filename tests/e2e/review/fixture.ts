// A branch review as GET /api/arch/branches/{id}/review answers it: a small
// "shopping list" change. Artifacts has no local simulator, so the review
// screen's tests serve this instead of the real repository.

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

const SERVICE_BEFORE = lines(
  'import { and, eq } from "drizzle-orm";',
  'import { getDb } from "@backend/db-models/db";',
  'import { tasks } from "@backend/db-models/tasks";',
  'import { taskPermissions } from "./permissions";',
  "",
  "export async function listTasks(principal: Principal) {",
  '  taskPermissions.require(principal, "view");',
  "  return getDb().select().from(tasks);",
  "}",
);

const SERVICE_AFTER = lines(
  'import { and, eq } from "drizzle-orm";',
  'import { getDb } from "@backend/db-models/db";',
  'import { tasks } from "@backend/db-models/tasks";',
  'import { taskPermissions } from "./permissions";',
  "",
  "export async function listTasks(principal: Principal, list?: string) {",
  '  taskPermissions.require(principal, "view");',
  "  const query = getDb().select().from(tasks);",
  "  return list ? query.where(eq(tasks.list, list)) : query;",
  "}",
  "",
  "/** Ticks every bought item off the shopping list at once. */",
  "export async function clearBought(principal: Principal) {",
  '  taskPermissions.require(principal, "update");',
  "  await getDb()",
  "    .delete(tasks)",
  '    .where(and(eq(tasks.list, "shopping"), eq(tasks.done, true)));',
  "}",
);

const MIGRATION = lines(
  "-- Shopping items are tasks on the shopping list.",
  "ALTER TABLE tasks ADD COLUMN list TEXT;",
  "CREATE INDEX tasks_list ON tasks (list);",
);

const SCREEN_BEFORE = lines(
  'import { Page } from "@frontend/ds/Page";',
  'import { TaskList } from "../widgets/TaskList";',
  "",
  "export function TasksScreen() {",
  '  return <Page title="Tasks"><TaskList /></Page>;',
  "}",
);

const SCREEN_AFTER = lines(
  'import { Page } from "@frontend/ds/Page";',
  'import { ShoppingList } from "../widgets/ShoppingList";',
  'import { TaskList } from "../widgets/TaskList";',
  "",
  "export function TasksScreen() {",
  "  return (",
  '    <Page title="Tasks">',
  "      <TaskList />",
  "      <ShoppingList />",
  "    </Page>",
  "  );",
  "}",
);

const TEST = lines(
  'import { expect, test } from "@playwright/test";',
  "",
  'test("bought items are cleared together", async ({ page }) => {',
  '  await page.goto("/tasks");',
  '  await page.getByRole("button", { name: "Clear bought" }).click();',
  '  await expect(page.getByText("Milk")).toHaveCount(0);',
  "});",
);

export const BRANCH_ID = "BR_reviewFixture";

export const REVIEW = {
  branch: {
    id: BRANCH_ID,
    name: "shopping-list",
    previewName: "shopping-list",
    previewUrl: "https://shopping-list.example.workers.dev",
    buildSessionId: "BS_reviewFixture",
    sessionViewable: true,
    userId: "USER_owner",
    userName: "Olive Owner",
    status: "ready",
    archivedAt: null,
    behindMain: false,
    createdAt: Date.UTC(2026, 10, 5, 9),
    updatedAt: Date.UTC(2026, 10, 5, 10),
  },
  baseCommit: "1f0e6c2b9a7d4e3f8a1b2c3d4e5f60718293a4b5",
  headCommit: "9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
  summary:
    "Adds a **shopping list** on the tasks page. Shopping items are tasks with `list = 'shopping'`, so sharing and permissions come for free.\n\nA migration adds the `list` column; `clearBought` deletes the bought items in one go.",
  brackets: [
    {
      title: "Clearing bought items",
      kind: "flow",
      description:
        "The service filters tasks by list and clears the bought shopping items; the screen shows the new list.",
      ranges: [
        {
          path: "backend/tasks/src/service.ts",
          start: 6,
          end: 18,
          note: "Listing by list, and the new clear action.",
        },
        {
          path: "frontend/tasks/src/screens/TasksScreen.tsx",
          start: 1,
          end: 12,
          note: "The shopping list sits under the tasks.",
        },
      ],
    },
    {
      title: "The list column",
      kind: "schema",
      description: "Tasks get a nullable `list` column, indexed.",
      ranges: [{ path: "migrations/0007_task_lists.sql", start: 1, end: 3, note: "" }],
    },
  ],
  commits: [
    {
      hash: "9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
      title: "Add a shopping list to the tasks page",
      request: "Can we have a shopping list? Something we can all tick off in the shop.",
      reasoning:
        "Shopping items reuse tasks with a `list` column instead of a new table, so sharing, assignees and the assistant's tools work unchanged.",
      merge: false,
      committedAt: Date.UTC(2026, 10, 5, 10),
    },
  ],
  files: [
    {
      path: "backend/tasks/src/service.ts",
      status: "modified",
      before: SERVICE_BEFORE,
      after: SERVICE_AFTER,
      omitted: null,
    },
    {
      path: "frontend/tasks/src/screens/TasksScreen.tsx",
      status: "modified",
      before: SCREEN_BEFORE,
      after: SCREEN_AFTER,
      omitted: null,
    },
    {
      path: "migrations/0007_task_lists.sql",
      status: "added",
      before: null,
      after: MIGRATION,
      omitted: null,
    },
    {
      path: "tests/e2e/tasks/shopping.spec.ts",
      status: "added",
      before: null,
      after: TEST,
      omitted: null,
    },
    {
      path: "pnpm-lock.yaml",
      status: "modified",
      before: null,
      after: null,
      omitted: "generated",
    },
  ],
};
