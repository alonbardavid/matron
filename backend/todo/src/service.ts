import { desc, eq } from "drizzle-orm";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { getDb } from "@backend/db-models/db";
import { todo } from "@backend/db-models/todo";
import type { TodoItem } from "@shared/contract/app/todo";

const log = logger("todo/service");

// The list is shared by the whole household: every signed-in member reads and
// writes it. `principal` is taken so a future per-member rule has a place to go.
export async function listTodos(_principal: Principal): Promise<TodoItem[]> {
  const rows = await getDb().select().from(todo).orderBy(desc(todo.createdAt));
  return rows.map(toItem);
}

export async function createTodo(principal: Principal, text: string): Promise<TodoItem> {
  const [row] = await getDb()
    .insert(todo)
    .values({ id: newEntityId("TODO"), text })
    .returning();
  log.info("todo created", { todoId: row!.id, userId: principal.userId });
  return toItem(row!);
}

export async function updateTodo(
  principal: Principal,
  id: string,
  changes: { text?: string; status?: "unchecked" | "checked" },
): Promise<TodoItem> {
  const [row] = await getDb()
    .update(todo)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(todo.id, id))
    .returning();
  if (!row) throw new DomainError("NOT_FOUND", "Todo not found");
  log.info("todo updated", { todoId: id, userId: principal.userId, ...changes });
  return toItem(row);
}

export async function removeTodo(principal: Principal, id: string): Promise<void> {
  const [row] = await getDb()
    .delete(todo)
    .where(eq(todo.id, id))
    .returning({ id: todo.id });
  if (!row) throw new DomainError("NOT_FOUND", "Todo not found");
  log.info("todo removed", { todoId: id, userId: principal.userId });
}

function toItem(row: typeof todo.$inferSelect): TodoItem {
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
