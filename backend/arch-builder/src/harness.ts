import { ContainerHarness, containerAgent } from "agents/harness/container";
import { AI_GATEWAY } from "@backend/commons/names";

// Two vCPUs: install, the builds and the tests are CPU-bound.
const BUILDER_INSTANCE = "standard-3";
/**
 * The five-minute rule, as the harness's idle timeout: a run parked on a
 * question runs nothing, and the container is snapshotted and stopped once
 * it has idled this long. The next turn restores it.
 */
const WAITING_GRACE_MS = 5 * 60_000;
/** The host the coding agent calls for its model; the harness adds the gateway and credentials outside the container. */
const MODEL_HOST = "anthropic.harness.internal";
const PLACEHOLDER_KEY = "cf-aig-placeholder";
const WORK_DIR = "/work";

/**
 * The container harness (Agents SDK) that owns the builder container for one
 * session: it starts the container from the builder image, runs every turn
 * as a durable operation, reattaches after an eviction, and snapshots the
 * workspace when the container idles. The coding agent's model calls leave
 * the container through the harness's egress, which adds the gateway and the
 * account token outside it.
 */
export function builderHarness(
  ctx: DurableObjectState,
  container: Container,
  env: Cloudflare.Env,
): ContainerHarness {
  const token = env.CLOUDFLARE_API_TOKEN ?? "";
  const gateway = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID ?? ""}/${AI_GATEWAY}/anthropic`;
  // What a gateway log entry says about the request.
  const metadata = {
    agent: "builder",
    host: hostOf(env.APP_ORIGIN),
    sessionId: ctx.id.name ?? "",
  };
  return new ContainerHarness({
    container,
    egress: ctx.exports.ContainerEgress,
    instance: BUILDER_INSTANCE,
    idleTimeoutMs: WAITING_GRACE_MS,
    agent: containerAgent({
      // `builder` is the image's key in the generated config's `containers[].images`.
      image: container.images.builder as string,
      adapter: "matron",
      env: {
        ANTHROPIC_BASE_URL: `http://${MODEL_HOST}`,
        ANTHROPIC_API_KEY: PLACEHOLDER_KEY,
        MATRON_WORK_DIR: WORK_DIR,
        // The install step starts the dev servers; test runs reuse them.
        MATRON_WARM_SERVERS: "1",
      },
      egress: [
        {
          host: MODEL_HOST,
          upstream: gateway,
          headers: {
            "cf-aig-authorization": `Bearer ${token}`,
            "x-api-key": token,
            "cf-aig-metadata": JSON.stringify(metadata),
          },
          strip: ["x-api-key", "authorization"],
        },
      ],
    }),
  });
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
