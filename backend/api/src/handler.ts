import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { logUnexpectedError, type ApiContext } from "@backend/commons/api";
import { todo } from "./routes/todo";

const handler = new OpenAPIHandler(
  { todo },
  { interceptors: [onError(logUnexpectedError)] },
);

/** Answers a request under /api/app/* from the application's procedures, or null when none claims it. */
export async function serveAppApi(
  request: Request,
  context: ApiContext,
): Promise<Response | null> {
  const { matched, response } = await handler.handle(request, { context });
  return matched ? response : null;
}
