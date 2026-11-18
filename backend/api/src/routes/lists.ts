import {
  addItem,
  createList,
  getItemAlarm,
  getList,
  listDueItems,
  listLists,
  moveItem,
  removeItem,
  removeList,
  setItemAlarm,
  updateItem,
  updateList,
} from "@backend/lists/service";
import { app } from "../implementer";

export const lists = app.lists.router({
  list: app.lists.list.handler(({ context, input }) =>
    listLists(context.principal, input.q),
  ),
  get: app.lists.get.handler(({ context, input }) =>
    getList(context.principal, input.id),
  ),
  create: app.lists.create.handler(({ context, input }) =>
    createList(context.principal, input),
  ),
  update: app.lists.update.handler(({ context, input: { id, ...changes } }) =>
    updateList(context.principal, id, changes),
  ),
  remove: app.lists.remove.handler(async ({ context, input }) => {
    await removeList(context.principal, input.id);
    return { ok: true as const };
  }),
  addItem: app.lists.addItem.handler(({ context, input: { id, ...item } }) =>
    addItem(context.principal, id, item),
  ),
  updateItem: app.lists.updateItem.handler(({ context, input: { id, ...changes } }) =>
    updateItem(context.principal, id, changes),
  ),
  moveItem: app.lists.moveItem.handler(({ context, input: { id, ...move } }) =>
    moveItem(context.principal, id, move),
  ),
  removeItem: app.lists.removeItem.handler(async ({ context, input }) => {
    await removeItem(context.principal, input.id);
    return { ok: true as const };
  }),
  dueItems: app.lists.dueItems.handler(({ context }) => listDueItems(context.principal)),
  itemAlarm: app.lists.itemAlarm.handler(({ context, input }) =>
    getItemAlarm(context.principal, input.id),
  ),
  setItemAlarm: app.lists.setItemAlarm.handler(({ context, input }) =>
    setItemAlarm(context.principal, input.id, input.minutesBefore),
  ),
});
