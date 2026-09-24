"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

const AGENT_NAME_KEY = "relay.agentName";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.localStorage.getItem(AGENT_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The specialist's display name on replies and decisions.
 * Signed in with Google, it's the account name (and `locked`, since the API records that identity anyway);
 * without sign-in it's a name the agent types once, remembered in this browser.
 */
export function useAgentName() {
  const { user } = useAuth();
  const stored = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "",
  );
  const setName = useCallback((value: string) => {
    try {
      window.localStorage.setItem(AGENT_NAME_KEY, value);
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((l) => l());
  }, []);
  return [user?.name ?? stored, setName, !!user] as const;
}
