import type { CSSProperties } from "react";

export const DEFAULT_ACCENT = "#4f46e5";

/** CSS variables that re-tint every `brand-*` utility inside the element from one accent colour. */
export function brandStyle(accent: string | null | undefined): CSSProperties | undefined {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent) || accent.toLowerCase() === DEFAULT_ACCENT) return undefined;
  const tint = (pct: number) => `color-mix(in oklab, ${accent} ${pct}%, white)`;
  const shade = (pct: number) => `color-mix(in oklab, ${accent} ${pct}%, black)`;
  return {
    "--color-brand-50": tint(8),
    "--color-brand-100": tint(16),
    "--color-brand-200": tint(30),
    "--color-brand-300": tint(50),
    "--color-brand-400": tint(72),
    "--color-brand-500": tint(88),
    "--color-brand-600": accent,
    "--color-brand-700": shade(85),
    "--color-brand-800": shade(70),
    "--color-brand-900": shade(55),
  } as CSSProperties;
}
