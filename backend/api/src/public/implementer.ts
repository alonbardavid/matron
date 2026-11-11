import { implement } from "@orpc/server";
import { domainErrors, type ApiContext } from "@backend/commons/api";
import { publicAppContract } from "@shared/contract/app/public/contract";

/**
 * The application's public procedures run for anyone: there is no principal
 * to rely on, so the service says what makes a call count.
 */
export const publicApp = implement(publicAppContract)
  .$context<ApiContext>()
  .use(domainErrors);
