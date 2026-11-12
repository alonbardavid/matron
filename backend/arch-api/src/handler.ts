import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { logUnexpectedError, type ApiContext } from "@backend/commons/api";
import { branches } from "./routes/branches";
import { review } from "./routes/review";
import { sessions } from "./routes/sessions";
import { settings } from "./routes/settings";
import { troubleshooting } from "./routes/troubleshooting";
import { upstream } from "./routes/upstream";

const handler = new OpenAPIHandler(
  { branches, review, sessions, settings, troubleshooting, upstream },
  { interceptors: [onError(logUnexpectedError)] },
);

/**
 * Answers a request under /api/arch/* from the router's procedures. The
 * socket, health and auth routes are matched before this; anything else that
 * no procedure claims is an unknown route, never the application's.
 */
export async function serveArchApi(
  request: Request,
  context: ApiContext,
): Promise<Response> {
  const { matched, response } = await handler.handle(request, { context });
  if (matched) return response;
  return Response.json({ message: "No such router route" }, { status: 404 });
}
