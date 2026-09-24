"use client";

import { Loader2, LockKeyhole, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { API_URL } from "@/lib/api";

/** Google's "G" mark, per their sign-in branding guidelines. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function LoginScreen() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  useEffect(() => {
    // The API's OAuth callback sends failures back as ?auth_error=…; show it once, then tidy the URL.
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("auth_error");
    if (authError) {
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.toString());
    }
    // Deferred so these updates don't happen synchronously inside the effect.
    void Promise.resolve().then(() => {
      if (authError) setError(authError);
      setLoginUrl(`${API_URL}/api/auth/google/login?return_to=${encodeURIComponent(url.toString())}`);
    });
    // Coming back from Google's page via the browser's back button restores this page from cache mid-"redirecting".
    const onPageShow = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-surface p-8 text-center shadow-sm">
        <LogoMark className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Sign in to Relay</h1>
        <p className="mt-1 text-sm text-slate-500">Use your work Google account to open the support console.</p>

        <div className="mt-6 flex min-h-11 items-center justify-center">
          {busy ? (
            <span className="flex items-center gap-2 text-sm text-slate-600" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Redirecting to Google…
            </span>
          ) : loginUrl ? (
            <a
              href={loginUrl}
              onClick={() => setBusy(true)}
              className="inline-flex h-11 w-[280px] items-center justify-center gap-3 rounded-full border border-slate-300 bg-surface px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <GoogleMark /> Sign in with Google
            </a>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading sign-in" />
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-left text-xs text-rose-700">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
          </p>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <LockKeyhole className="h-3 w-3" aria-hidden /> Access is by invitation. Ask a workspace admin if you can&apos;t get in.
        </p>
      </div>
    </div>
  );
}
