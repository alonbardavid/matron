import { oc } from "@orpc/contract";
import { z } from "zod";

export const ROLE_VALUES = ["owner", "admin", "member"] as const;

/** A household member as the application shows them: for sharing, assigning and attendance. */
export const householdUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLE_VALUES),
  /** Where their picture is served from, or null without one. */
  avatarUrl: z.string().nullable(),
});
export type HouseholdUser = z.infer<typeof householdUserSchema>;

export const avatarSchema = z.object({ avatarUrl: z.string().nullable() });
export type Avatar = z.infer<typeof avatarSchema>;

export const usersContract = {
  list: oc
    .route({ method: "GET", path: "/api/app/users" })
    .output(z.array(householdUserSchema)),
  /** Your own picture: a PNG, JPEG, GIF or WebP, stored as a square JPEG. */
  setAvatar: oc
    .route({ method: "POST", path: "/api/app/users/me/avatar" })
    .input(z.object({ picture: z.file() }))
    .output(avatarSchema),
  removeAvatar: oc
    .route({ method: "DELETE", path: "/api/app/users/me/avatar" })
    .output(avatarSchema),
};
