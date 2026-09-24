"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getLiveStatus, subscribeLive, subscribeLiveStatus } from "@/lib/live";

/** While the live feed is connected, polling only runs as a slow safety net. */
const LIVE_FALLBACK_POLL_MS = 60_000;

export function useLiveStatus() {
  return useSyncExternalStore(subscribeLiveStatus, getLiveStatus, () => "off" as const);
}

/**
 * Minimal data-fetching hook with manual reload, optional polling and optional live updates.
 * `key` identifies the request: when it changes, the data is refetched.
 * `live` lists server topics (e.g. ["tickets", "messages"]) that trigger an immediate refetch when they change.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string, pollMs?: number, live?: readonly string[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const fnRef = useRef(fn);
  const liveStatus = useLiveStatus();
  const liveKey = live?.join(",") ?? "";

  useEffect(() => {
    fnRef.current = fn;
  });

  // Initial load, reloads, and (slow) polling.
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
    const every = pollMs && liveKey && liveStatus === "live" ? Math.max(pollMs, LIVE_FALLBACK_POLL_MS) : pollMs;
    // Poll only while the tab is visible, and catch up immediately when the agent comes back to it.
    const timer = every ? window.setInterval(() => document.visibilityState === "visible" && void load(false), every) : undefined;
    const onVisible = () => document.visibilityState === "visible" && void load(false);
    if (every) document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (every) document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, pollMs, version, liveKey, liveStatus]);

  // Push updates: refetch as soon as the server reports a relevant change.
  useEffect(() => {
    if (!liveKey) return;
    const topics = liveKey.split(",");
    let cancelled = false;
    let inFlight = false;
    let again = false;
    const refresh = async () => {
      // Collapse bursts: at most one request in flight plus one queued.
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const result = await fnRef.current();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        inFlight = false;
        if (again && !cancelled) {
          again = false;
          void refresh();
        }
      }
    };
    const unsubscribe = subscribeLive((changed) => {
      if (changed.includes("*") || changed.some((t) => topics.includes(t))) void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [liveKey, key]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}
