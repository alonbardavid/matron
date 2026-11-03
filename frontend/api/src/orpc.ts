import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { contract, type ApiClient } from "@shared/contract/contract";

// The branch travels in the referer: the page URL carries ?branch=, and the
// browser sends it on every same-origin call, so nothing is added here.
const link = new OpenAPILink(contract, {
  url: window.location.origin,
  fetch: (request, init) =>
    globalThis.fetch(request, { ...init, credentials: "include" }),
});

/** The raw typed client, for imperative calls outside React Query. */
export const api: ApiClient = createORPCClient(link);

/** TanStack Query helpers: `orpc.todo.list.queryOptions()`, `orpc.todo.key()`, ... */
export const orpc = createTanstackQueryUtils(api);
