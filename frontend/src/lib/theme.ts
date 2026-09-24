import type { CSSProperties } from "react";

export const DEFAULT_ACCENT = "#4f46e5";

export const THEME_KEY = "relay.theme";

/**
 * Inlined in the root layout so the theme class is set before first paint (no light flash for dark-mode users).
 * Keep in sync with `apply()` in hooks/useTheme.ts.
 */
export const THEME_BOOT_SCRIPT = `try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("theme-dark",d)}catch(e){}`;

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
