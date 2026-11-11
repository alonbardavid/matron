import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { logUnexpectedError, type ApiContext } from "@backend/commons/api";
import { calendar } from "./routes/calendar";

const handler = new OpenAPIHandler(
  { calendar },
  { interceptors: [onError(logUnexpectedError)] },
);

/** Answers a request under PUBLIC_APP_PATH from the public procedures, or null when none claims it. */
export async function servePublicAppApi(
  request: Request,
  context: ApiContext,
): Promise<Response | null> {
  const { matched, response } = await handler.handle(request, { context });
  return matched ? response : null;
}
