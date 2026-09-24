import type { CSSProperties, ComponentType } from "react";
import { LogoMark } from "@/components/Logo";

type Item = { icon: ComponentType<{ className?: string }>; name: string };

/**
 * Pure-CSS 3D orbit: the agents circle the Relay mark on a tilted plane, each counter-rotated so it
 * always faces the viewer. The spin is a registered custom property (see `.orbit-*` in globals.css).
 */
export function AgentOrbit({ items }: { items: Item[] }) {
  return (
    <div className="orbit" aria-hidden>
      <div className="orbit-plane">
        <div className="orbit-glow" />
        <div className="orbit-track" />
        <div className="orbit-track orbit-track-inner" />
        <div className="orbit-core">
          <LogoMark className="h-14 w-14 drop-shadow-[0_10px_24px_rgb(79_70_229_/_0.45)]" />
        </div>
        {items.map(({ icon: Icon, name }, i) => (
          <div key={name} className="orbit-item" style={{ "--a": `${(360 / items.length) * i}deg` } as CSSProperties}>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-brand-600 shadow-lg shadow-brand-900/10">
              <Icon className="h-5 w-5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
