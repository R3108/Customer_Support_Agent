"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Live `prefers-reduced-motion` preference; false during server rendering. */
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
