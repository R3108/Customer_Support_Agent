"use client";

import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { cx } from "@/lib/format";

type Props = {
  children: ReactNode;
  className?: string;
  /** Maximum pointer-driven rotation in degrees. */
  max?: number;
  /** Resting rotation, so a card can sit at an angle before it is hovered. */
  restX?: number;
  restY?: number;
  /** Adds a cursor-following glow and border highlight (see `.spotlight` in globals.css). */
  spotlight?: boolean;
};

/**
 * 3D perspective tilt that follows the mouse. The element keeps its resting angle on touch devices,
 * and globals.css drops the transform entirely under prefers-reduced-motion.
 */
export function Tilt({ children, className, max = 8, restX = 0, restY = 0, spotlight = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--tilt-x", `${((0.5 - y) * max).toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${((x - 0.5) * max).toFixed(2)}deg`);
      el.style.setProperty("--spot-x", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--spot-y", `${(y * 100).toFixed(1)}%`);
      el.dataset.active = "true";
    });
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    el.style.removeProperty("--tilt-x");
    el.style.removeProperty("--tilt-y");
    delete el.dataset.active;
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={cx("tilt", spotlight && "spotlight", className)}
      style={{ "--tilt-rest-x": `${restX}deg`, "--tilt-rest-y": `${restY}deg` } as CSSProperties}
    >
      {children}
    </div>
  );
}
