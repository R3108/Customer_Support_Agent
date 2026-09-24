"use client";

import { useLayoutEffect, useRef, useState } from "react";

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/;

/** Splits "$1,248.05" into prefix "$", number 1248.05, suffix "", keeping its decimals and digit grouping. */
function parse(value: string) {
  const m = NUMBER.exec(value);
  if (!m) return null;
  const raw = m[0];
  return {
    prefix: value.slice(0, m.index),
    suffix: value.slice(m.index + raw.length),
    number: Number(raw.replace(/,/g, "")),
    decimals: raw.split(".")[1]?.length ?? 0,
    grouped: raw.includes(","),
  };
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Displays a formatted stat and tweens its number whenever it changes (counting up from 0 on first render),
 * with a brief highlight on live updates. Screen readers only get the final value.
 */
export function AnimatedValue({ value, duration = 900 }: { value: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const [prev, setPrev] = useState(value);
  const [flash, setFlash] = useState(0);

  // Adjust state during render when the value changes (React's recommended alternative to an effect).
  if (value !== prev) {
    setPrev(value);
    setFlash((n) => n + 1);
  }

  useLayoutEffect(() => {
    const el = ref.current;
    const target = parse(value);
    if (!el || !target) return;
    const start = from.current;
    const format = (n: number) =>
      `${target.prefix}${n.toLocaleString("en-US", {
        minimumFractionDigits: target.decimals,
        maximumFractionDigits: target.decimals,
        useGrouping: target.grouped,
      })}${target.suffix}`;
    from.current = target.number;
    if (start === target.number || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = value;
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      el.textContent = t === 1 ? value : format(start + (target.number - start) * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    el.textContent = format(start);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <>
      <span className="sr-only">{value}</span>
      <span key={flash} ref={ref} aria-hidden className={flash ? "value-flash tabular-nums" : "tabular-nums"}>
        {value}
      </span>
    </>
  );
}
