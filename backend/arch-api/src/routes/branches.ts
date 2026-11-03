import { beginAbandon, beginMerge, listBranches } from "@backend/arch-branches/service";
import { startAbandon, startMerge } from "@backend/arch-builder/jobs";
import { mainHead } from "@backend/arch-repository/service";
import { arch } from "../implementer";

export const branches = arch.branches.router({
  list: arch.branches.list.handler(async ({ context }) => ({
    current: context.branch,
    // Without main's head the list still answers; nothing then shows as behind.
    branches: await listBranches(context.principal, await mainHead().catch(() => null)),
  })),
  merge: arch.branches.merge.handler(async ({ context, input }) => {
    const branch = await beginMerge(context.principal, input.id, await mainHead());
    await startMerge(branch);
    return { ok: true as const };
  }),
  remove: arch.branches.remove.handler(async ({ context, input }) => {
    const branch = await beginAbandon(context.principal, input.id);
    await startAbandon(branch);
    return { ok: true as const };
  }),
});
