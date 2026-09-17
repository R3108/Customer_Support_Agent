import Link from "next/link";
import { cx } from "@/lib/format";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("h-7 w-7", className)} aria-hidden>
      <defs>
        <linearGradient id="relay-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          {/* Brand variables so the mark follows the workspace accent colour. */}
          <stop style={{ stopColor: "var(--color-brand-400)" }} />
          <stop offset="1" style={{ stopColor: "var(--color-brand-600)" }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#relay-g)" />
      <path d="M9 11.5c0-1.4 1.1-2.5 2.5-2.5h6a4.5 4.5 0 0 1 0 9H14l-5 4.5V11.5Z" fill="white" fillOpacity=".95" />
      <circle cx="21.5" cy="21.5" r="3.5" fill="white" fillOpacity=".55" />
    </svg>
  );
}

export function Logo({ dark = false, href = "/" }: { dark?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2">
      <LogoMark />
      <span className={cx("text-lg font-semibold tracking-tight", dark ? "text-white" : "text-slate-900")}>Relay</span>
    </Link>
  );
}
