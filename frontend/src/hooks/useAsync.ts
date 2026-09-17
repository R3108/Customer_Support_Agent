"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal data-fetching hook with manual reload and optional polling.
 * `key` identifies the request: when it changes, the data is refetched.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    const load = async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const result = await fnRef.current();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };
    void load(true);
    const timer = pollMs ? window.setInterval(() => void load(false), pollMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [key, pollMs, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}
