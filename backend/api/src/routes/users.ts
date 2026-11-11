import { removeAvatar, setAvatar } from "@backend/household/avatar";
import { listHouseholdUsers } from "@backend/household/users";
import { app } from "../implementer";

export const users = app.users.router({
  list: app.users.list.handler(({ context }) => listHouseholdUsers(context.principal)),
  setAvatar: app.users.setAvatar.handler(async ({ input, context }) => {
    // The contract's File is the browser's; the Worker's has the same shape.
    const picture = input.picture as unknown as Blob & { name: string };
    return setAvatar(context.principal, context.branch, {
      bytes: new Uint8Array(await picture.arrayBuffer()),
      name: picture.name,
    });
  }),
  removeAvatar: app.users.removeAvatar.handler(({ context }) =>
    removeAvatar(context.principal, context.branch),
  ),
});
