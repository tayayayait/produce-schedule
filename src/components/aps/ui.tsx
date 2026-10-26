import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Family } from "@/lib/aps/data";

export const FAM_BG: Record<Family, string> = {
  ECU: "bg-fam-ecu", ADAS: "bg-fam-adas", IOT: "bg-fam-iot", POWER: "bg-fam-power",
};

export type Tone = "success" | "warning" | "danger" | "muted" | "primary";
const TONE: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  muted: "text-muted-foreground",
  primary: "text-primary",
};
const TONE_PILL: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/30",
};

export function Pill({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold tracking-wide", TONE_PILL[tone], className)}>
      {children}
    </span>
  );
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card shadow-card", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, unit, tone = "muted", sub }: { label: string; value: string; unit?: string; tone?: Tone; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-card">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={cn("num text-[28px] font-bold leading-9 tracking-tight", TONE[tone])}>{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function PageHead({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export const otdTone = (v: number): Tone => (v >= 95 ? "success" : v >= 85 ? "warning" : "danger");
export const tardTone = (v: number): Tone => (v === 0 ? "success" : v <= 240 ? "warning" : "danger");
export const setupTone = (v: number): Tone => (v <= 10 ? "success" : v <= 18 ? "warning" : "danger");
export const biTone = (lvl: string): Tone => (lvl === "CRITICAL" ? "danger" : lvl === "WARNING" ? "warning" : "success");
