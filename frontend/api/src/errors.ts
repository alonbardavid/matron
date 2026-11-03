import { ORPCError } from "@orpc/client";
import { notifications } from "@mantine/notifications";

export function errorMessage(err: unknown): string {
  if (err instanceof ORPCError) return err.message || err.code;
  if (err instanceof Error) return err.message || "Something went wrong";
  if (typeof err === "string") return err;
  return "Something went wrong";
}

export function hasErrorCode(err: unknown, code: string): boolean {
  return err instanceof ORPCError && err.code === code;
}

export function notifyError(err: unknown, title?: string): void {
  notifications.show({ color: "red", title, message: errorMessage(err) });
}
