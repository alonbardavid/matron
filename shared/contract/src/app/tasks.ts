import { oc } from "@orpc/contract";
import { z } from "zod";
import { alarmSchema } from "./notifications";

/** A calendar day, `YYYY-MM-DD`. */
export const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  creatorId: z.string(),
  dueDate: dayString.nullable(),
  completedAt: z.number().nullable(),
  /** User ids the task is shared with, besides the creator. */
  sharedWith: z.array(z.string()),
  /** User ids the task is assigned to; always among the creator and `sharedWith`. */
  assignees: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Task = z.infer<typeof taskSchema>;

const title = z.string().trim().min(1, "Give the task a title").max(200);
const description = z.string().trim().max(5000);
const userIds = z.array(z.string()).max(100);

export const taskCreateSchema = z.object({
  title,
  description: description.optional(),
  dueDate: dayString.nullable().optional(),
  sharedWith: userIds.optional(),
  assignees: userIds.optional(),
});
export type TaskCreate = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = z.object({
  title: title.optional(),
  description: description.optional(),
  dueDate: dayString.nullable().optional(),
  completed: z.boolean().optional(),
  sharedWith: userIds.optional(),
  assignees: userIds.optional(),
});
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;

export const tasksContract = {
  /** Every task the caller created or was given: open ones first, by due date. */
  list: oc.route({ method: "GET", path: "/api/app/tasks" }).output(z.array(taskSchema)),
  create: oc
    .route({ method: "POST", path: "/api/app/tasks" })
    .input(taskCreateSchema)
    .output(taskSchema),
  update: oc
    .route({ method: "PUT", path: "/api/app/tasks/{id}" })
    .input(taskUpdateSchema.extend({ id: z.string() }))
    .output(taskSchema),
  remove: oc
    .route({ method: "DELETE", path: "/api/app/tasks/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
  /** The caller's own alarm on the task: how long before its due day ends they are reminded. */
  alarm: oc
    .route({ method: "GET", path: "/api/app/tasks/{id}/alarm" })
    .input(z.object({ id: z.string() }))
    .output(alarmSchema),
  /** Sets, changes or (null) removes the caller's own alarm on the task. */
  setAlarm: oc
    .route({ method: "PUT", path: "/api/app/tasks/{id}/alarm" })
    .input(alarmSchema.extend({ id: z.string() }))
    .output(alarmSchema),
};
