"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks whether an element is on screen. With `once`, it stays true after the first sighting,
 * which suits entrance animations; without it, it suits pausing work that runs while visible.
 */
export function useInView<T extends Element = HTMLDivElement>({ threshold = 0.35, once = false } = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) io.disconnect();
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once]);

  return [ref, inView] as const;
}
