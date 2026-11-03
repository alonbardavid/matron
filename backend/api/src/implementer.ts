import { implement } from "@orpc/server";
import { domainErrors, requirePrincipal, type ApiContext } from "@backend/commons/api";
import { appContract } from "@shared/contract/app/contract";

/** Every application procedure runs for a signed-in principal; services decide the rest. */
export const app = implement(appContract)
  .$context<ApiContext>()
  .use(domainErrors)
  .use(requirePrincipal);
