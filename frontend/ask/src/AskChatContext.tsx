import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface PendingMessage {
  sessionId: string;
  text: string;
}

interface AskChatContextValue {
  opened: boolean;
  /** Null while the panel is a draft: no conversation exists until something is asked. */
  sessionId: string | null;
  /** A message to send as soon as its conversation is connected. */
  pending: PendingMessage | null;
  open: (sessionId: string) => void;
  /** Opens an empty panel; the conversation is created by the first message. */
  openNew: () => void;
  openWithMessage: (sessionId: string, text: string) => void;
  close: () => void;
  clearPending: () => void;
}

const AskChatContext = createContext<AskChatContextValue | null>(null);

/** Which conversation with the assistant is open in the side panel, if any. */
export function AskChatProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMessage | null>(null);
  const open = useCallback((id: string) => {
    setSessionId(id);
    setOpened(true);
  }, []);
  const openNew = useCallback(() => {
    setPending(null);
    setSessionId(null);
    setOpened(true);
  }, []);
  const openWithMessage = useCallback((id: string, text: string) => {
    setPending({ sessionId: id, text });
    setSessionId(id);
    setOpened(true);
  }, []);
  const close = useCallback(() => setOpened(false), []);
  const clearPending = useCallback(() => setPending(null), []);
  const value = useMemo(
    () => ({
      opened,
      sessionId,
      pending,
      open,
      openNew,
      openWithMessage,
      close,
      clearPending,
    }),
    [opened, sessionId, pending, open, openNew, openWithMessage, close, clearPending],
  );
  return <AskChatContext.Provider value={value}>{children}</AskChatContext.Provider>;
}

export function useAskChat(): AskChatContextValue {
  const ctx = useContext(AskChatContext);
  if (!ctx) throw new Error("useAskChat must be used inside AskChatProvider");
  return ctx;
}
