import { implement } from "@orpc/server";
import {
  encodeHibernationRPCEvent,
  HibernationEventIterator,
  HibernationPlugin,
} from "@orpc/server/hibernation";
import { RPCHandler } from "@orpc/server/websocket";
import { sessionChatContract, type ServerFrame } from "@shared/contract/arch/sessions";

/** What the session object does when a chat procedure is called on one of its sockets. */
export interface ChatHost {
  /** A subscription opened on `ws`: replay from `after`, then stream to it under `iteratorId`. */
  subscribed(ws: WebSocket, iteratorId: string, after: string | undefined): void;
  /** A user message typed on `ws`. */
  received(ws: WebSocket, text: string): Promise<void>;
}

export interface ChatContext {
  ws: WebSocket;
}

const chat = implement(sessionChatContract).$context<ChatContext>();

/**
 * The chat contract served over hibernating WebSockets. A subscription is a
 * hibernation iterator: oRPC answers the call with its id and the host sends
 * every later frame itself with `encodeFrame`, so the object may sleep between.
 */
export function chatHandler(host: ChatHost): RPCHandler<ChatContext> {
  const router = chat.router({
    subscribe: chat.subscribe.handler(
      ({ input, context }) =>
        new HibernationEventIterator<ServerFrame>((id) =>
          host.subscribed(context.ws, id, input.after),
        ),
    ),
    send: chat.send.handler(({ input, context }) =>
      host.received(context.ws, input.text),
    ),
  });
  return new RPCHandler(router, { plugins: [new HibernationPlugin()] });
}

/** A frame for the subscription `iteratorId`, in the encoding the client's link reads. */
export function encodeFrame(iteratorId: string, frame: ServerFrame): string {
  return encodeHibernationRPCEvent(iteratorId, frame);
}
