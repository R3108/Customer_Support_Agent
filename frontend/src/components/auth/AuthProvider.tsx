"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, UNAUTHORIZED_EVENT } from "@/lib/api";
import { setLiveEnabled } from "@/lib/live";
import type { AuthMode, AuthUser, UserRole } from "@/lib/types";

type AuthState = {
  /** "loading" until the first /api/auth/me answers; "unreachable" if the API is down. */
  status: "loading" | "ready" | "unreachable";
  mode: AuthMode | null;
  googleClientId: string | null;
  user: AuthUser | null;
  role: UserRole | null;
};

type AuthApi = AuthState & {
  isAdmin: boolean;
  /** True when the console may be shown (signed in, or auth not required). */
  signedIn: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", mode: null, googleClientId: null, user: null, role: null });

  const refresh = useCallback(async () => {
    try {
      const [me, config] = await Promise.all([api.me(), api.authConfig()]);
      setState({ status: "ready", mode: me.mode, googleClientId: config.google_client_id || null, user: me.user, role: me.role });
    } catch {
      setState((s) => ({ ...s, status: "unreachable" }));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    // Any console request answered with 401 (expired or revoked session) re-checks who we are.
    const onUnauthorized = () => void refresh();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      await refresh();
    }
  }, [refresh]);

  const signedIn = state.status === "ready" && (state.mode === "open" || state.role !== null);
  // The live feed authenticates with the session cookie; API-key mode can't use it and keeps polling.
  const liveAllowed = signedIn && state.mode !== "api_key";
  useEffect(() => setLiveEnabled(liveAllowed), [liveAllowed]);

  const value = useMemo<AuthApi>(
    () => ({ ...state, isAdmin: state.role === "admin", signedIn, refresh, signOut }),
    [state, signedIn, refresh, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
