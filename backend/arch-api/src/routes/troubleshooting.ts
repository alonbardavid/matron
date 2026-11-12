import {
  clearContainers,
  listAllBranches,
  listContainers,
  listDatabases,
  listMerges,
  removeDatabase,
  revertMerge,
  stopContainer,
} from "@backend/arch-troubleshooting/service";
import { arch } from "../implementer";

const done = { done: true };

export const troubleshooting = arch.troubleshooting.router({
  databases: {
    list: arch.troubleshooting.databases.list.handler(({ context }) =>
      listDatabases(context.principal),
    ),
    remove: arch.troubleshooting.databases.remove.handler(async ({ context, input }) => {
      await removeDatabase(context.principal, input.id);
      return done;
    }),
  },
  branches: {
    list: arch.troubleshooting.branches.list.handler(({ context }) =>
      listAllBranches(context.principal),
    ),
  },
  merges: {
    list: arch.troubleshooting.merges.list.handler(({ context }) =>
      listMerges(context.principal),
    ),
    revert: arch.troubleshooting.merges.revert.handler(async ({ context, input }) => {
      await revertMerge(context.principal, input.id);
      return done;
    }),
  },
  containers: {
    list: arch.troubleshooting.containers.list.handler(({ context }) =>
      listContainers(context.principal),
    ),
    stop: arch.troubleshooting.containers.stop.handler(async ({ context, input }) => {
      await stopContainer(context.principal, input.name);
      return done;
    }),
    clear: arch.troubleshooting.containers.clear.handler(async ({ context }) => {
      await clearContainers(context.principal);
      return done;
    }),
  },
});
