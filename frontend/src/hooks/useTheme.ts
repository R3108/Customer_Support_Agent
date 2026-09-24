"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme";

export type ThemePreference = "system" | "light" | "dark";

const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function isDark(pref: ThemePreference) {
  return pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function apply(pref: ThemePreference) {
  document.documentElement.classList.toggle("theme-dark", isDark(pref));
}

/**
 * Runs `commit` inside a view transition that reveals the new theme as a circle growing from `origin`
 * (see `html.vt-theme` in globals.css). Falls back to an instant swap without support or with reduced motion.
 */
function revealTheme(dark: boolean, origin: { x: number; y: number } | undefined, commit: () => void) {
  const root = document.documentElement;
  const unchanged = root.classList.contains("theme-dark") === dark;
  if (unchanged || !document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    commit();
    return;
  }
  const { x, y } = origin ?? { x: window.innerWidth / 2, y: 0 };
  root.style.setProperty("--reveal-x", `${x}px`);
  root.style.setProperty("--reveal-y", `${y}px`);
  root.style.setProperty("--reveal-r", `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`);
  root.classList.add("vt-theme");
  document.startViewTransition(commit).finished.finally(() => root.classList.remove("vt-theme"));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, read, () => "system" as ThemePreference);

  // Follow the OS setting live while the preference is "system".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => read() === "system" && apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /** `origin` (viewport px) is where the circular theme reveal starts, usually the clicked control. */
  const setPreference = useCallback((pref: ThemePreference, origin?: { x: number; y: number }) => {
    try {
      window.localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* storage unavailable: still apply for this page view */
    }
    revealTheme(isDark(pref), origin, () => {
      apply(pref);
      listeners.forEach((l) => l());
    });
  }, []);

  return { preference, setPreference };
}
