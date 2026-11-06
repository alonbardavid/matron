import { implement } from "@orpc/server";
import {
  domainErrors,
  fileResponses,
  requirePrincipal,
  type ApiContext,
} from "@backend/commons/api";
import { appContract } from "@shared/contract/app/contract";

/**
 * Every application procedure runs for a signed-in principal; services decide
 * the rest. One whose output is a file stream is answered with the file's headers.
 */
export const app = implement(appContract)
  .$context<ApiContext>()
  .use(domainErrors)
  .use(fileResponses)
  .use(requirePrincipal);
