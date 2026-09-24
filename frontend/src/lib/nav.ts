import { BarChart3, BookOpenText, FlaskConical, Headset, MessagesSquare, Settings } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Headset;
  /** Second key of the `G` then key shortcut. */
  key: string;
  adminOnly?: boolean;
};

/** Product navigation, in visual order; the order also decides the direction of page transitions. */
export const NAV: NavItem[] = [
  { href: "/demo", label: "Live demo", icon: MessagesSquare, key: "d" },
  { href: "/console", label: "Agent console", icon: Headset, key: "c" },
  { href: "/knowledge", label: "Knowledge base", icon: BookOpenText, key: "k" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, key: "a" },
  { href: "/evals", label: "Test Lab", icon: FlaskConical, key: "t" },
  { href: "/settings", label: "Settings", icon: Settings, key: "s", adminOnly: true },
];

const navIndex = (path: string) => NAV.findIndex((item) => path.startsWith(item.href));

/**
 * View-transition type for navigating between two product pages: content slides left when moving to a page
 * further right in the nav, and right when moving back. Empty when staying put or leaving the product nav.
 */
export function navTransition(from: string, to: string): string[] {
  const a = navIndex(from);
  const b = navIndex(to);
  if (a === -1 || b === -1 || a === b) return [];
  return [b > a ? "nav-forward" : "nav-back"];
}
