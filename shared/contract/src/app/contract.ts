import { conversationsContract } from "./conversations";
import { calendarContract } from "./calendar";
import { filesContract } from "./files";
import { listsContract } from "./lists";
import { notificationsContract } from "./notifications";
import { usersContract } from "./users";

/**
 * The application's procedures for signed-in members, all under /api/app/*. A
 * feature adds its contract here. The few that answer anyone are a contract
 * of their own, `public/contract.ts`.
 */
export const appContract = {
  conversations: conversationsContract,
  calendar: calendarContract,
  files: filesContract,
  lists: listsContract,
  notifications: notificationsContract,
  users: usersContract,
};
export type AppContract = typeof appContract;
