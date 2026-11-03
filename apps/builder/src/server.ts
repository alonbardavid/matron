import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { JobRunner } from "./jobs.js";
import { JobError, type BuilderJob, type SocketFrame } from "./types.js";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY = 4 * 1024 * 1024;

const runner = new JobRunner();

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validateJob(value: unknown): BuilderJob {
  const job = value as Partial<BuilderJob> | null;
  if (!job || typeof job !== "object") throw new Error("job must be an object");
  if (!["build", "continue", "merge", "abandon"].includes(job.mode ?? ""))
    throw new Error("invalid mode");
  if (typeof job.sessionId !== "string") throw new Error("sessionId missing");
  if (!job.branch || typeof job.branch.name !== "string")
    throw new Error("branch missing");
  if (
    !job.repository ||
    typeof job.repository.remote !== "string" ||
    typeof job.repository.token !== "string"
  ) {
    throw new Error("repository missing");
  }
  if (!job.cloudflare || typeof job.cloudflare.apiToken !== "string")
    throw new Error("cloudflare missing");
  return {
    ...(job as BuilderJob),
    request: job.request ?? "",
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health")
    return json(res, 200, { ok: true });

  if (req.method === "POST" && url.pathname === "/jobs") {
    let job: BuilderJob;
    try {
      job = validateJob(JSON.parse(await readBody(req)));
    } catch (error) {
      return json(res, 400, {
        error: error instanceof Error ? error.message : "invalid job",
      });
    }
    try {
      runner.submit(job);
    } catch (error) {
      return json(res, 409, { error: error instanceof Error ? error.message : "busy" });
    }
    return json(res, 202, { accepted: true, mode: job.mode, seq: runner.events.lastSeq });
  }

  json(res, 404, { error: "not found" });
}

/**
 * The Worker's connection: every event after `after` is replayed, then each
 * new one is pushed as it happens; user messages arrive as frames.
 */
function attach(socket: WebSocket, after: number): void {
  const send = (event: unknown) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  };
  for (const event of runner.events.after(after)) send(event);
  const unsubscribe = runner.events.subscribe(send);
  socket.on("message", (data) => {
    try {
      const frame = JSON.parse(data.toString()) as Partial<SocketFrame>;
      if (frame.type === "message" && typeof frame.text === "string")
        runner.message(frame.text);
    } catch (error) {
      console.error("bad socket frame:", error);
    }
  });
  socket.on("close", unsubscribe);
  socket.on("error", (error) => console.error("socket error:", error));
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error("request failed:", error);
    if (!res.headersSent)
      json(res, 500, {
        error: error instanceof JobError ? error.message : "internal error",
      });
    else res.end();
  });
});

const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const after = Number(url.searchParams.get("after") ?? 0);
  sockets.handleUpgrade(req, socket, head, (ws) =>
    attach(ws, Number.isFinite(after) ? after : 0),
  );
});

server.listen(PORT, () => {
  console.log(
    `builder listening on :${PORT} (status ${runner.status}, seq ${runner.events.lastSeq})`,
  );
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received; closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
