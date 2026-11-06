import { conversationsContract } from "./conversations";
import { calendarContract } from "./calendar";
import { notificationsContract } from "./notifications";
import { tasksContract } from "./tasks";
import { usersContract } from "./users";

/** The application's procedures, all under /api/app/*. A feature adds its contract here. */
export const appContract = {
  conversations: conversationsContract,
  calendar: calendarContract,
  notifications: notificationsContract,
  tasks: tasksContract,
  users: usersContract,
};
export type AppContract = typeof appContract;
