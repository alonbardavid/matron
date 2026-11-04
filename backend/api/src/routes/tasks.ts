import { createTask, listTasks, removeTask, updateTask } from "@backend/tasks/service";
import { app } from "../implementer";

export const tasks = app.tasks.router({
  list: app.tasks.list.handler(({ context }) => listTasks(context.principal)),
  create: app.tasks.create.handler(({ context, input }) =>
    createTask(context.principal, input),
  ),
  update: app.tasks.update.handler(({ context, input: { id, ...changes } }) =>
    updateTask(context.principal, id, changes),
  ),
  remove: app.tasks.remove.handler(async ({ context, input }) => {
    await removeTask(context.principal, input.id);
    return { ok: true as const };
  }),
});
