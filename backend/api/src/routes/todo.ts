import { createTodo, listTodos, removeTodo, updateTodo } from "@backend/todo/service";
import { app } from "../implementer";

export const todo = app.todo.router({
  list: app.todo.list.handler(({ context }) => listTodos(context.principal)),
  create: app.todo.create.handler(({ context, input }) =>
    createTodo(context.principal, input.text),
  ),
  update: app.todo.update.handler(({ context, input: { id, ...changes } }) =>
    updateTodo(context.principal, id, changes),
  ),
  remove: app.todo.remove.handler(async ({ context, input }) => {
    await removeTodo(context.principal, input.id);
    return { ok: true as const };
  }),
});
