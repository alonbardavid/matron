import type { SeedUser } from "../seed-sql";

export const OWNER: SeedUser = {
  email: "owner@example.com",
  password: "owner-password-123",
  name: "Olive Owner",
  role: "owner",
};

export const MEMBER: SeedUser = {
  email: "member@example.com",
  password: "member-password-123",
  name: "Max Member",
  role: "member",
};
