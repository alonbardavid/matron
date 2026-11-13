import { ORPCError, os } from "@orpc/server";
import { DomainError } from "./errors";
import { fileHeaders, fileStreamMeta } from "./file-stream";
import { logger } from "./logger";
import type { Principal } from "./principal";

const log = logger("commons/api");

/** The context every oRPC handler runs with: who asks (null when signed out) and on which branch. */
export interface ApiContext {
  principal: Principal | null;
  /** "main" or a branch id. */
  branch: string;
  /** Roughly where the request came from, by Cloudflare's reading of its IP; absent when Cloudflare gives none. */
  near?: { latitude: number; longitude: number };
  /** The response's headers, from the handler's ResponseHeadersPlugin. */
  resHeaders?: Headers;
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

/**
 * Answers a procedure whose output is a tagged file stream (see `fileStream`)
 * with the file's headers; any other output passes through. Runs on the
 * implementer, outside output validation, which sees the stream the contract declares.
 */
export const fileResponses = os
  .$context<ApiContext>()
  .middleware(async ({ context, next }) => {
    const result = await next();
    const meta = fileStreamMeta(result.output);
    if (meta) {
      if (!context.resHeaders)
        throw new Error("Serving a file needs the ResponseHeadersPlugin");
      for (const [name, value] of Object.entries(fileHeaders(meta))) {
        context.resHeaders.set(name, value);
      }
    }
    return result;
  });

/** For a handler's `onError`: an ORPCError is an answer the handler meant to give; anything else is a bug. */
export function logUnexpectedError(error: unknown): void {
  if (error instanceof ORPCError && error.code !== "INTERNAL_SERVER_ERROR") return;
  log.error("request handler threw", { err: error });
}
