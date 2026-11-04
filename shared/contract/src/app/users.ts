import { oc } from "@orpc/contract";
import { z } from "zod";

export const ROLE_VALUES = ["owner", "admin", "member"] as const;

/** A household member as the application shows them: for sharing, assigning and attendance. */
export const householdUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLE_VALUES),
});
export type HouseholdUser = z.infer<typeof householdUserSchema>;

export const usersContract = {
  list: oc
    .route({ method: "GET", path: "/api/app/users" })
    .output(z.array(householdUserSchema)),
};
