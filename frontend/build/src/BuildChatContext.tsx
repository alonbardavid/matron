import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FileUIPart } from "ai";

/** What is said to the session, with the files that go with it. */
export interface BuildInput {
  text: string;
  files: FileUIPart[];
}

interface PendingMessage extends BuildInput {
  sessionId: string;
}

interface BuildChatContextValue {
  opened: boolean;
  /** Null while the chat is a draft: no session exists until the first message. */
  sessionId: string | null;
  /** A message to send as soon as its session is connected. */
  pending: PendingMessage | null;
  open: (sessionId: string) => void;
  /** Opens an empty chat; the session is created when something is sent. */
  openNew: () => void;
  openWithMessage: (sessionId: string, input: BuildInput) => void;
  close: () => void;
  clearPending: () => void;
}

const BuildChatContext = createContext<BuildChatContextValue | null>(null);

export function BuildChatProvider({ children }: { children: ReactNode }) {
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
  const openWithMessage = useCallback((id: string, input: BuildInput) => {
    setPending({ sessionId: id, ...input });
    setSessionId(id);
    setOpened(true);
  }, []);
  const close = useCallback(() => setOpened(false), []);
  const clearPending = useCallback(() => setPending(null), []);

  const value = useMemo<BuildChatContextValue>(
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
  return <BuildChatContext.Provider value={value}>{children}</BuildChatContext.Provider>;
}

export function useBuildChat(): BuildChatContextValue {
  const ctx = useContext(BuildChatContext);
  if (!ctx) throw new Error("useBuildChat must be used inside BuildChatProvider");
  return ctx;
}
