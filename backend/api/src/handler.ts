import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { logUnexpectedError, type ApiContext } from "@backend/commons/api";
import { conversations } from "./routes/conversations";
import { calendar } from "./routes/calendar";
import { tasks } from "./routes/tasks";
import { users } from "./routes/users";

const handler = new OpenAPIHandler(
  { calendar, conversations, tasks, users },
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
