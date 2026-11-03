export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const MAIN_BRANCH = "main";

/** Who a request is from. The branch it is for is carried separately. */
export interface Principal {
  userId: string;
  name: string;
  email: string;
  role: Role;
}
