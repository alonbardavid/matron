import type { Context } from "hono";
import { logger } from "./logger";

const log = logger("commons/errors");

export type DomainErrorCode =
  "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "CONFLICT" | "BAD_REQUEST" | "UNAVAILABLE";

/**
 * An answer a service meant to give. An oRPC procedure maps it to the matching
 * ORPCError; a plain route's error hook answers with `toResponse()`.
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }

  /** The HTTP status that answers this error. */
  get status(): number {
    return DOMAIN_ERROR_STATUS[this.code];
  }

  /** The answer as a plain route gives it: `{ message }` with the matching status. */
  toResponse(): Response {
    return Response.json({ message: this.message }, { status: this.status });
  }
}

const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  BAD_REQUEST: 400,
  UNAVAILABLE: 503,
};

/**
 * The error hook of a Hono app: a DomainError thrown anywhere under a plain
 * route is the answer the service meant to give, and anything else is a bug
 * that answers 500.
 */
export function answerError(err: Error, c: Context): Response {
  if (err instanceof DomainError) return err.toResponse();
  log.error("unhandled error", { err });
  return c.json({ message: err.message }, 500);
}
