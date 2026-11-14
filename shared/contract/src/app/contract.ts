import { conversationsContract } from "./conversations";
import { calendarContract } from "./calendar";
import { filesContract } from "./files";
import { notificationsContract } from "./notifications";
import { tasksContract } from "./tasks";
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
  notifications: notificationsContract,
  tasks: tasksContract,
  users: usersContract,
};
export type AppContract = typeof appContract;
