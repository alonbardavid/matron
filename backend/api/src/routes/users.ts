import { listHouseholdUsers } from "@backend/household/users";
import { app } from "../implementer";

export const users = app.users.router({
  list: app.users.list.handler(({ context }) => listHouseholdUsers(context.principal)),
});
