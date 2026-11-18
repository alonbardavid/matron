import { checkUpstream, mergeUpstream } from "@backend/arch-upstream/service";
import { arch } from "../implementer";

export const upstream = arch.upstream.router({
  check: arch.upstream.check.handler(({ context }) => checkUpstream(context.principal)),
  merge: arch.upstream.merge.handler(({ context }) => mergeUpstream(context.principal)),
});
