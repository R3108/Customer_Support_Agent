"use client";

import { Clock, DollarSign, Users } from "lucide-react";
import { useId, useState, type CSSProperties } from "react";
import { AnimatedValue } from "@/components/fx/AnimatedValue";

// Defaults mirror the backend's reporting settings (minutes_per_human_ticket, cost_per_agent_hour).
const HOURS_PER_FTE_MONTH = 160;
const GROWTH_PRICE = 349;

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
};

function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-slate-600">
          {label}
        </label>
        <output htmlFor={id} className="font-semibold tabular-nums text-slate-900">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range mt-2 w-full"
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </div>
  );
}

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

/** Interactive savings estimate using the same formula as the Analytics dashboard's ROI card. */
export function RoiCalculator() {
  const [volume, setVolume] = useState(6000);
  const [automation, setAutomation] = useState(60);
  const [minutes, setMinutes] = useState(8);
  const [rate, setRate] = useState(32);

  const hours = (volume * (automation / 100) * minutes) / 60;
  const saved = hours * rate;
  const fte = hours / HOURS_PER_FTE_MONTH;
  const multiple = saved / GROWTH_PRICE;

  return (
    <div className="grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 lg:grid-cols-2">
      <div className="space-y-6 p-6 sm:p-8">
        <Slider label="Conversations per month" value={volume} min={500} max={50000} step={500} format={whole} onChange={setVolume} />
        <Slider label="Resolved by AI" value={automation} min={10} max={90} step={5} format={(v) => `${v}%`} onChange={setAutomation} />
        <Slider label="Minutes a human spends per ticket" value={minutes} min={2} max={30} step={1} format={(v) => `${v} min`} onChange={setMinutes} />
        <Slider label="Loaded cost per agent hour" value={rate} min={15} max={90} step={1} format={(v) => `$${v}`} onChange={setRate} />
        <p className="text-xs leading-relaxed text-slate-500">
          Estimate only. Relay reports the real figure from your own conversations in Analytics, using the minutes and hourly cost you set.
        </p>
      </div>

      <div className="relative overflow-hidden bg-ink-950 p-6 text-white sm:p-8">
        <div aria-hidden className="aurora-a pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-500/30 blur-3xl" />
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black_20%,transparent_70%)]" />
        <div className="relative">
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <DollarSign className="h-4 w-4" aria-hidden /> Estimated savings per month
          </p>
          <p className="mt-2 text-5xl font-semibold tracking-tight sm:text-6xl">
            <AnimatedValue value={`$${whole(saved)}`} duration={450} />
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <Clock className="h-3.5 w-3.5" aria-hidden /> Agent hours freed
              </p>
              <p className="mt-1 text-2xl font-semibold">
                <AnimatedValue value={whole(hours)} duration={450} />
              </p>
            </div>
            <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <Users className="h-3.5 w-3.5" aria-hidden /> Full-time agents
              </p>
              <p className="mt-1 text-2xl font-semibold">
                <AnimatedValue value={fte.toFixed(1)} duration={450} />
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-gradient-to-r from-brand-500/25 to-fuchsia-500/20 p-4 ring-1 ring-brand-400/30">
            <p className="text-sm text-slate-200">
              {multiple >= 1 ? (
                <>
                  Pays for the Growth plan <b className="text-white">{multiple >= 10 ? whole(multiple) : multiple.toFixed(1)}×</b> over.
                </>
              ) : (
                <>Start on the free Starter plan until your volume grows.</>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
