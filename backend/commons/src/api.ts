import { ORPCError, os } from "@orpc/server";
import { DomainError } from "./errors";
import { logger } from "./logger";
import type { Principal } from "./principal";

const log = logger("commons/api");

/** The context every oRPC handler runs with: who asks (null when signed out) and on which branch. */
export interface ApiContext {
  principal: Principal | null;
  /** "main" or a branch id. */
  branch: string;
}

/** Refuses a signed-out request and narrows the context to a present principal. */
export const requirePrincipal = os
  .$context<ApiContext>()
  .middleware(async ({ context, next }) => {
    if (!context.principal) {
      throw new ORPCError("UNAUTHORIZED", { message: "Not signed in" });
    }
    return next({ context: { principal: context.principal } });
  });

/** Maps a DomainError thrown by a service to the oRPC error a client expects. */
export const domainErrors = os.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof DomainError) {
      throw new ORPCError(err.code, { message: err.message });
    }
    throw err;
  }
});

/** For a handler's `onError`: an ORPCError is an answer the handler meant to give; anything else is a bug. */
export function logUnexpectedError(error: unknown): void {
  if (error instanceof ORPCError && error.code !== "INTERNAL_SERVER_ERROR") return;
  log.error("request handler threw", { err: error });
}
