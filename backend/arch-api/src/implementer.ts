import { implement } from "@orpc/server";
import { domainErrors, requirePrincipal, type ApiContext } from "@backend/commons/api";
import { archContract } from "@shared/contract/arch/contract";

/** Every router procedure runs for a signed-in principal; services decide the rest. */
export const arch = implement(archContract)
  .$context<ApiContext>()
  .use(domainErrors)
  .use(requirePrincipal);
