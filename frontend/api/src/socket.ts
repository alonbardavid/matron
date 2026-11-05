import { AgentClient } from "agents/client";
import {
  sessionSocketPath,
  type ChatFrame,
  type ClientFrame,
  type ServerFrame,
} from "@shared/contract/arch/sessions";
import { useCallback, useEffect, useRef, useState } from "react";

export type SocketStatus = "connecting" | "open" | "closed";

/** The session's phase, as the session object syncs it. */
export type SessionPhase =
  "planning" | "building" | "waiting" | "deployed" | "failed" | "timed_out" | "closed";

function readPhase(state: unknown): SessionPhase | null {
  if (typeof state !== "object" || state === null) return null;
  const phase = (state as { phase?: unknown }).phase;
  return typeof phase === "string" ? (phase as SessionPhase) : null;
}

function mergeFrame(frames: ChatFrame[], frame: ChatFrame): ChatFrame[] {
  const index = frames.findIndex((f) => f.id === frame.id);
  const next =
    index === -1 ? [...frames, frame] : frames.map((f, i) => (i === index ? frame : f));
  return next.sort((a, b) => a.ts - b.ts);
}

/** A frame from the session; the client's own protocol messages are not ours. */
function readFrame(data: unknown): ServerFrame | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data) as { type?: unknown };
    if (typeof value !== "object" || value === null || typeof value.type !== "string")
      return null;
    if (value.type.startsWith("cf_")) return null;
    return value as ServerFrame;
  } catch {
    return null;
  }
}

/**
 * The build chat for one session: a socket the agents client keeps open and
 * reconnects for us, carrying the frames of `shared/contract/arch/sessions`.
 * Every connection replays the transcript from the last frame seen, so a
 * reconnect fills any gap.
 */
export function useChatSocket(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatFrame[]>([]);
  const [status, setStatus] = useState<SocketStatus>("closed");
  // True once the stored transcript has been replayed on this connection.
  const [synced, setSynced] = useState(false);
  // What the session is doing, pushed by the object as it changes.
  const [phase, setPhase] = useState<SessionPhase | null>(null);
  const clientRef = useRef<AgentClient | null>(null);
  const lastIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setMessages([]);
    setSynced(false);
    setPhase(null);
    lastIdRef.current = undefined;
    if (!sessionId) {
      setStatus("closed");
      return;
    }
    setStatus("connecting");
    const client = new AgentClient({
      agent: "build-session-object",
      name: sessionId,
      host: window.location.host,
      // The router's own path for the session; it names the object server-side.
      basePath: sessionSocketPath(sessionId).replace(/^\//, ""),
      // Read for every connection, so a reconnect asks for what it missed.
      query: () => Promise.resolve({ after: lastIdRef.current ?? null }),
      onStateUpdate: (state) => setPhase(readPhase(state)),
    });
    clientRef.current = client;
    client.addEventListener("open", () => setStatus("open"));
    client.addEventListener("close", () => setStatus("closed"));
    client.addEventListener("message", (event) => {
      const frame = readFrame(event.data);
      if (!frame) return;
      if (frame.type === "synced") {
        setSynced(true);
        return;
      }
      lastIdRef.current = frame.id;
      setMessages((prev) => mergeFrame(prev, frame));
    });
    return () => {
      if (clientRef.current === client) clientRef.current = null;
      client.close();
    };
  }, [sessionId]);

  /** Sends a user message; false when there is no open socket to send it on. */
  const send = useCallback((text: string): boolean => {
    const client = clientRef.current;
    if (!client || client.readyState !== WebSocket.OPEN) return false;
    const frame: ClientFrame = { type: "send", text };
    client.send(JSON.stringify(frame));
    return true;
  }, []);

  return { messages, status, synced, phase, send };
}
