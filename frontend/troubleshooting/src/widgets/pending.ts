import { useCallback, useEffect, useState } from "react";

/**
 * Rows with a change under way: marked when the call starts, kept until the
 * listing no longer shows what the change was meant to end, so the row keeps
 * its spinner while Cloudflare catches up.
 */
export function usePending(stillPending: (key: string) => boolean, listed: unknown) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const mark = useCallback((...added: string[]) => {
    setKeys((current) => new Set([...current, ...added]));
  }, []);
  // Each fresh listing drops the keys whose change has shown up.
  useEffect(() => {
    setKeys((current) => {
      const kept = [...current].filter(stillPending);
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [listed, stillPending]);
  return { has: (key: string) => keys.has(key), any: keys.size > 0, mark };
}
