import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import {
  sessionSocketPath,
  type ChatFrame,
  type SessionChatContract,
} from "@shared/contract/arch/sessions";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./errors";

const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
const PING = "ping";
const PONG = "pong";

export type ChatClient = ContractRouterClient<SessionChatContract>;

export function sessionSocketUrl(sessionId: string): string {
  const url = new URL(sessionSocketPath(sessionId), window.location.origin);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

type LinkSocket = ConstructorParameters<typeof RPCLink>[0]["websocket"];

/**
 * The socket as the link sees it. Our keepalive pings are answered by the
 * Durable Object without waking it, and the pongs are not the link's messages.
 */
function withoutPongs(ws: WebSocket): LinkSocket {
  const wrapped = new WeakMap<EventListenerOrEventListenerObject, EventListener>();
  const call = (listener: EventListenerOrEventListenerObject, event: Event) =>
    typeof listener === "function" ? listener(event) : listener.handleEvent(event);
  return {
    get readyState() {
      return ws.readyState;
    },
    send: (data: Parameters<WebSocket["send"]>[0]) => ws.send(data),
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== "message") return ws.addEventListener(type, listener, options);
      const filtered: EventListener = (event) => {
        if ((event as MessageEvent).data !== PONG) call(listener, event);
      };
      wrapped.set(listener, filtered);
      ws.addEventListener(type, filtered, options);
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      ws.removeEventListener(type, wrapped.get(listener) ?? listener, options);
    },
  };
}

/** The chat contract's client over a freshly opened socket for the session. */
export function openSessionChat(sessionId: string): {
  ws: WebSocket;
  client: ChatClient;
} {
  const ws = new WebSocket(sessionSocketUrl(sessionId));
  const client: ChatClient = createORPCClient(
    new RPCLink({ websocket: withoutPongs(ws) }),
  );
  return { ws, client };
}

export type SocketStatus = "connecting" | "open" | "closed";

function mergeFrame(frames: ChatFrame[], frame: ChatFrame): ChatFrame[] {
  const index = frames.findIndex((f) => f.id === frame.id);
  const next =
    index === -1 ? [...frames, frame] : frames.map((f, i) => (i === index ? frame : f));
  return next.sort((a, b) => a.ts - b.ts);
}

function errorFrame(text: string): ChatFrame {
  return { type: "error", id: crypto.randomUUID(), ts: Date.now(), text };
}

interface Connection {
  /** The session this socket was opened for; every event is checked against it. */
  sessionId: string;
  ws: WebSocket;
  client: ChatClient;
}

export function useChatSocket(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatFrame[]>([]);
  const [status, setStatus] = useState<SocketStatus>("closed");
  // True once the stored transcript has been replayed on this connection.
  const [synced, setSynced] = useState(false);
  const connectionRef = useRef<Connection | null>(null);
  const lastIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setMessages([]);
    setSynced(false);
    lastIdRef.current = undefined;
    if (!sessionId) {
      setStatus("closed");
      return;
    }

    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    // An event belongs to the connection that raised it. It is applied only
    // while that connection is the current one for this session; a socket
    // replaced by a reconnect, or left over from another session, is ignored.
    const isCurrent = (connection: Connection) =>
      connectionRef.current === connection && connection.sessionId === sessionId;

    const subscribe = async (connection: Connection) => {
      try {
        const frames = await connection.client.subscribe({ after: lastIdRef.current });
        for await (const frame of frames) {
          if (!isCurrent(connection)) return;
          if (frame.type === "synced") {
            setSynced(true);
            continue;
          }
          lastIdRef.current = frame.id;
          setMessages((prev) => mergeFrame(prev, frame));
        }
      } catch {
        // The socket closed under the subscription; onclose reconnects.
      }
    };

    const connect = () => {
      setStatus("connecting");
      const connection: Connection = { sessionId, ...openSessionChat(sessionId) };
      connectionRef.current = connection;
      const { ws } = connection;

      ws.onopen = () => {
        if (!isCurrent(connection)) return;
        attempt = 0;
        setStatus("open");
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(PING);
        }, PING_INTERVAL_MS);
        void subscribe(connection);
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (!isCurrent(connection)) return;
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = undefined;
        connectionRef.current = null;
        setStatus("closed");
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      const connection = connectionRef.current;
      if (connection?.sessionId === sessionId) {
        // Detached first, so its close event is not this session's.
        connectionRef.current = null;
        connection.ws.close();
      }
    };
  }, [sessionId]);

  /** Sends a user message; false when there is no open socket to send it on. */
  const send = useCallback((text: string): boolean => {
    const connection = connectionRef.current;
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) return false;
    connection.client.send({ text }).catch((err: unknown) => {
      // The socket closed before the reply came: the transcript replayed on
      // reconnect shows whether the message arrived, so there is nothing to add.
      if (connection.ws.readyState !== WebSocket.OPEN) return;
      setMessages((prev) => mergeFrame(prev, errorFrame(errorMessage(err))));
    });
    return true;
  }, []);

  return { messages, status, synced, send };
}
