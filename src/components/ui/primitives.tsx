import * as React from "react";
import * as RDialog from "@radix-ui/react-dialog";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import { X, Loader2, ChevronDown, Info } from "lucide-react";
import { cx } from "@/lib/util";

// ---------------------------------------------------------------- Button
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover shadow-[var(--shadow-sm)]",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2 shadow-[var(--shadow-sm)]",
  ghost: "text-ink-2 hover:bg-surface-3/70 hover:text-ink",
  subtle: "bg-surface-2 text-ink hover:bg-surface-3",
  danger: "bg-danger text-white hover:opacity-90",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: "xs" | "sm" | "md";
  icon?: React.ReactNode;
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({ variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium transition-colors duration-100 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "sm" && "h-7 px-2.5 text-[12.5px]",
        size === "xs" && "h-6 px-2 text-[12px]",
        !children && (size === "md" ? "w-8 px-0" : size === "sm" ? "w-7 px-0" : "w-6 px-0"),
        BTN[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Inputs
const field = "w-full rounded-[7px] border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 outline-none transition-shadow focus:border-line-strong focus:shadow-[0_0_0_3px_var(--focus)]";

export function Input({ className, ref, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cx(field, "h-8", className)} {...p} />;
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(field, "py-2 min-h-20 resize-y", className)} {...p} />;
}

export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cx("relative", className)}>
      <select className={cx(field, "h-8 appearance-none pr-7 cursor-default")} {...p}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
    </div>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="text-[11.5px] text-danger">{error}</span> : hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={cx("absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-transform", checked ? "translate-x-[14px]" : "translate-x-[2px]")} />
    </button>
  );
}

// ---------------------------------------------------------------- Card & layout
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface shadow-[var(--shadow-sm)]", className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          {icon}
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-[var(--font-display)] text-[22px] font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Badge
export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent" | "primary";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
  primary: "bg-primary text-primary-fg",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] font-medium", TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Tooltip
export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return children;
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-[80] max-w-72 rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] leading-snug text-ink-2 shadow-[var(--shadow-md)] animate-fade">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function InfoTip({ content }: { content: React.ReactNode }) {
  return (
    <Tip content={content}>
      <button type="button" aria-label="Más información" className="inline-flex text-ink-3 hover:text-ink-2">
        <Info className="size-3.5" />
      </button>
    </Tip>
  );
}

// ---------------------------------------------------------------- Dialog / Sheet
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[1px] animate-fade" />
        <RDialog.Content
          style={{ width: `min(${width}px, calc(100vw - 32px))`, animation: "pop-in 160ms ease-out both" }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] flex-col rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)] outline-none"
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
            <div>
              <RDialog.Title className="text-[15px] font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-0.5 text-[12.5px] text-ink-3">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{String(title)}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="sm" icon={<X className="size-4" />} aria-label="Cerrar" />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Sheet({ open, onOpenChange, title, subtitle, children, width = 560, actions }: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; width?: number; actions?: React.ReactNode }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/15 animate-fade" />
        <RDialog.Content
          style={{ width: `min(${width}px, 100vw)`, animation: "sheet-in 180ms ease-out both" }}
          className="fixed right-0 top-0 z-50 flex h-full flex-col border-l border-line bg-surface shadow-[var(--shadow-lg)] outline-none"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-5 pb-3.5">
            <div className="min-w-0">
              <RDialog.Title className="truncate text-[15px] font-semibold">{title}</RDialog.Title>
              <RDialog.Description className={subtitle ? "mt-0.5 text-[12.5px] text-ink-3" : "sr-only"}>{subtitle ?? String(title)}</RDialog.Description>
            </div>
            <div className="flex items-center gap-1.5">
              {actions}
              <RDialog.Close asChild>
                <Button variant="ghost" size="sm" icon={<X className="size-4" />} aria-label="Cerrar" />
              </RDialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------------------------------------------------------------- Menu
export function Menu({ trigger, items, align = "end" }: { trigger: React.ReactElement; items: Array<{ label: string; icon?: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | "sep">; align?: "start" | "end" }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align={align} sideOffset={4} className="z-[70] min-w-44 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-md)] animate-fade">
          {items.map((it, i) =>
            it === "sep" ? (
              <RMenu.Separator key={i} className="my-1 h-px bg-line" />
            ) : (
              <RMenu.Item
                key={i}
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cx("flex h-7 cursor-default items-center gap-2 rounded-[5px] px-2 text-[12.5px] outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40", it.danger ? "text-danger" : "text-ink")}
              >
                {it.icon}
                {it.label}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

// ---------------------------------------------------------------- Segmented control / tabs
export function Segmented<T extends string>({ value, onChange, options, size = "md", className }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode }>; size?: "sm" | "md"; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-lg bg-surface-3/80 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-[6px] px-2.5 font-medium transition-all",
            size === "md" ? "h-7 text-[12.5px]" : "h-6 text-[12px]",
            o.value === value ? "bg-surface text-ink shadow-[var(--shadow-sm)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: string; count?: number }> }) {
  return (
    <div role="tablist" className="mb-4 flex gap-0.5 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cx("relative -mb-px flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium transition-colors", t.value === value ? "text-ink" : "text-ink-3 hover:text-ink-2")}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded bg-surface-3 px-1 text-[11px] text-ink-3">{t.count}</span>}
          {t.value === value && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-primary" />}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- States
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-md", className)} />;
}

export function EmptyState({ icon, title, body, action, compact }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center", compact ? "px-4 py-6" : "px-6 py-12")}>
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-surface-2 text-ink-3 [&_svg]:size-5">{icon}</div>}
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[12.5px] text-ink-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Explicit data states: never show 0 for unknown values. */
export function NoData({ kind = "no_data", className }: { kind?: "no_data" | "not_connected" | "stale"; className?: string }) {
  const label = kind === "not_connected" ? "No conectada" : kind === "stale" ? "Puede estar desactualizado" : "Sin datos";
  return <span className={cx("text-[12px] font-medium text-ink-3", kind === "stale" && "text-warning", className)}>{label}</span>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-[10.5px] font-medium text-ink-3">{children}</kbd>;
}

export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "warning" | "danger" | "primary" }) {
  const color = { accent: "bg-accent", warning: "bg-warning", danger: "bg-danger", primary: "bg-primary" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
