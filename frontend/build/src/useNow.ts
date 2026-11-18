import { useEffect, useState, useSyncExternalStore } from "react";

const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let now = Date.now();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const each of listeners) each();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * The current time, fresh to within half a minute, for labels such as
 * "10 minutes ago". Every label shares one timer.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}

/** The current time, fresh every second while `running`; the time of the last render otherwise. */
export function useSeconds(running: boolean): number {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setAt(Date.now());
    const ticker = setInterval(() => setAt(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, [running]);
  return at;
}
