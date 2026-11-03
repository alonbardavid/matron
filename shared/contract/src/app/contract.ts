import { todoContract } from "./todo";

/** The application's procedures, all under /api/app/*. A feature adds its contract here. */
export const appContract = {
  todo: todoContract,
};
export type AppContract = typeof appContract;
