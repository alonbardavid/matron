export type DomainErrorCode =
  "NOT_FOUND" | "FORBIDDEN" | "UNAUTHORIZED" | "CONFLICT" | "BAD_REQUEST" | "UNAVAILABLE";

/** An answer a service meant to give; routes turn it into the matching HTTP status. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  BAD_REQUEST: 400,
  UNAVAILABLE: 503,
};
