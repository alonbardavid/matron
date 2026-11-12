import { calendarPublicContract } from "./calendar";

/**
 * The application's public procedures, all under PUBLIC_APP_PATH: they answer
 * anyone, signed in or not, so each says itself what makes a call count. Kept
 * apart from the members' contract, and implemented apart. A feature adds its
 * public contract here.
 */
export const publicAppContract = {
  calendar: calendarPublicContract,
};
export type PublicAppContract = typeof publicAppContract;
