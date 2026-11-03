import { oc } from "@orpc/contract";
import { z } from "zod";

export const TODO_STATUSES = ["unchecked", "checked"] as const;

export const todoItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(TODO_STATUSES),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export const todoContract = {
  list: oc
    .route({ method: "GET", path: "/api/app/todo" })
    .output(z.array(todoItemSchema)),
  create: oc
    .route({ method: "POST", path: "/api/app/todo" })
    .input(z.object({ text: z.string().trim().min(1).max(500) }))
    .output(todoItemSchema),
  update: oc
    .route({ method: "PUT", path: "/api/app/todo/{id}" })
    .input(
      z.object({
        id: z.string(),
        text: z.string().trim().min(1).max(500).optional(),
        status: z.enum(TODO_STATUSES).optional(),
      }),
    )
    .output(todoItemSchema),
  remove: oc
    .route({ method: "DELETE", path: "/api/app/todo/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ ok: z.literal(true) })),
};
