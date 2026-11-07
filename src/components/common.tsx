import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Project, ProjectStatus, Severity } from "@/domain/types";
import { STATUS_LABEL } from "@/domain/types";
import { formatMoney, bagCurrencies, type MoneyBag } from "@/domain/money";
import { Badge, NoData, Tip, type Tone } from "./ui/primitives";
import { cx } from "@/lib/util";
import { fmtPct } from "@/lib/format";

const STATUS_TONE: Record<ProjectStatus, Tone> = {
  idea: "neutral", research: "neutral", design: "info", planning: "info", development: "accent", testing: "accent", beta: "warning",
  launched: "success", production: "success", maintenance: "success", paused: "neutral", archived: "neutral",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const map: Record<Severity, [Tone, string]> = { critical: ["danger", "Crítica"], warning: ["warning", "Atención"], info: ["info", "Info"] };
  return <Badge tone={map[severity][0]}>{map[severity][1]}</Badge>;
}

const PALETTE = ["#1D2E47", "#3F8F8C", "#8A5A44", "#5B6B8C", "#7A6A3A", "#4E6B5A", "#6B4E71", "#2F6690"];
export const projectColor = (p: Pick<Project, "color" | "name">) => p.color ?? PALETTE[Math.abs([...p.name].reduce((a, c) => a + c.charCodeAt(0), 0)) % PALETTE.length];

export function ProjectAvatar({ project, size = 28 }: { project: Pick<Project, "name" | "icon" | "color" | "logo_data">; size?: number }) {
  const initials = project.icon || project.name.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  if (project.logo_data) return <img src={project.logo_data} alt="" width={size} height={size} className="shrink-0 rounded-[7px] object-cover" />;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[7px] font-semibold text-white"
      style={{ width: size, height: size, background: projectColor(project), fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}

/** Shows a per-currency amount list; never sums different currencies. */
export function MoneyBagView({ bag, empty = "no_data", compact, className, signed }: { bag: MoneyBag; empty?: "no_data" | "zero"; compact?: boolean; className?: string; signed?: boolean }) {
  const cur = bagCurrencies(bag).filter((c) => bag[c] !== undefined);
  if (!cur.length) return empty === "zero" ? <span className={className}>0</span> : <NoData />;
  return (
    <span className={cx("inline-flex flex-col tabular", className)}>
      {cur.map((c) => (
        <span key={c} className={cx(signed && bag[c] < 0 && "text-danger")}>
          {formatMoney(bag[c], c, { compact })}
        </span>
      ))}
    </span>
  );
}

export function Delta({ value, inverse, suffix = "vs período anterior" }: { value: number | null; inverse?: boolean; suffix?: string }) {
  if (value === null) return <Tip content="No hay un valor del período anterior (o es cero) para calcular la variación"><span className="text-[11.5px] text-ink-3">sin comparación</span></Tip>;
  const good = inverse ? value < 0 : value > 0;
  const Icon = Math.abs(value) < 0.5 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx("inline-flex items-center gap-0.5 text-[11.5px] font-medium", Math.abs(value) < 0.5 ? "text-ink-3" : good ? "text-success" : "text-danger")} title={suffix}>
      <Icon className="size-3" />
      {fmtPct(Math.abs(value), 0)}
    </span>
  );
}

export function Stat({ label, value, sub, onClick, icon, hint }: { label: string; value: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; icon?: React.ReactNode; hint?: string }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      title={hint}
      className={cx("flex min-w-0 flex-col items-start gap-1 rounded-xl border border-line bg-surface px-3.5 py-3 text-left shadow-[var(--shadow-sm)]", onClick && "transition-colors hover:border-line-strong hover:bg-surface-2/50")}
    >
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-3 [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="text-[19px] font-semibold leading-tight tracking-[-0.01em] tabular">{value}</span>
      {sub && <span className="text-[11.5px] text-ink-3">{sub}</span>}
    </Comp>
  );
}

export function SourceNote({ source, period, updated }: { source: string; period?: string; updated?: string | null }) {
  return (
    <span className="text-[11px] text-ink-3">
      Fuente: {source}
      {period ? ` · ${period}` : ""}
      {updated ? ` · act. ${updated}` : ""}
    </span>
  );
}
