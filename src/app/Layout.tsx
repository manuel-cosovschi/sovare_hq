import * as React from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { PanelLeft, Search, FlaskConical, Plus } from "lucide-react";
import { NAV } from "./nav";
import { useApp } from "./AppContext";
import { useData } from "./hooks";
import { listAlerts } from "@/repos/alerts";
import { listTasks } from "@/repos/tasks";
import { connectorStates } from "@/integrations/runner";
import { Kbd, Menu, Tip, Button } from "@/components/ui/primitives";
import { cx, todayStr } from "@/lib/util";
import { isNative } from "@/platform/runtime";
import { CommandPalette } from "./CommandPalette";
import { QuickDialogs } from "./QuickDialogs";
import markUrl from "@/assets/sovare-mark.svg";

/** Sovare isotype on the brand navy tile (generated from assets/brand/sovare-isotipo.svg). */
function Mark({ size = 22 }: { size?: number }) {
  return <img src={markUrl} width={size} height={size} alt="Sovare" className="shrink-0 rounded-[24%]" draggable={false} />;
}
export { Mark };

function useBadges() {
  const alerts = useData(["alerts", "open"], () => listAlerts("open"));
  const tasks = useData(["tasks"], listTasks);
  const integ = useData(["integrations", "states"], connectorStates);
  const today = todayStr();
  return {
    "/": alerts.data?.filter((a) => a.severity !== "info").length ?? 0,
    "/tasks": tasks.data?.filter((t) => t.due_on && t.due_on < today && !["done", "canceled"].includes(t.status)).length ?? 0,
    "/integrations": integ.data?.filter((s) => s.status === "error").length ?? 0,
  } as Record<string, number>;
}

export function Layout() {
  const app = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const badges = useBadges();
  const collapsed = app.sidebarCollapsed;
  const mainRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        app.setPaletteOpen(true);
      } else if (k === "b" && !e.shiftKey) {
        e.preventDefault();
        app.toggleSidebar();
      } else if (e.shiftKey && k === "e") {
        e.preventDefault();
        app.openQuick("expense");
      } else if (e.shiftKey && k === "i") {
        e.preventDefault();
        app.openQuick("income");
      } else if (e.shiftKey && k === "t") {
        e.preventDefault();
        app.openQuick("task");
      } else if (e.shiftKey && k === "p") {
        e.preventDefault();
        app.openQuick("project");
      } else if (!e.shiftKey && !e.altKey) {
        const item = NAV.find((n) => n.shortcut === e.key);
        if (item) {
          e.preventDefault();
          nav(item.to);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, nav]);

  const native = isNative();
  return (
    <div className="flex h-full">
      <aside
        className={cx("flex h-full shrink-0 flex-col border-r border-line bg-sidebar transition-[width] duration-200", collapsed ? "w-[60px]" : "w-[228px]")}
        aria-label="Navegación principal"
      >
        <div className={cx("drag-region flex shrink-0 items-end px-3 pb-2", native ? "h-[52px]" : "h-[46px]", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div className={cx("no-drag flex items-center gap-2", native && "pl-[62px]")}>
              {!native && <Mark />}
              {!native && <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Sovare HQ</span>}
            </div>
          )}
          <Tip content={<>Mostrar/ocultar barra lateral <Kbd>⌘B</Kbd></>} side="right">
            <Button variant="ghost" size="sm" className="no-drag" icon={<PanelLeft className="size-4" />} onClick={app.toggleSidebar} aria-label="Alternar barra lateral" />
          </Tip>
        </div>
        <div className="px-2.5 pb-2">
          <button
            onClick={() => app.setPaletteOpen(true)}
            className={cx("flex h-8 w-full items-center gap-2 rounded-[7px] border border-line bg-surface/70 px-2 text-[12.5px] text-ink-3 transition-colors hover:bg-surface", collapsed && "justify-center px-0")}
            aria-label="Buscar"
          >
            <Search className="size-3.5 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Buscar…</span>
                <Kbd>⌘K</Kbd>
              </>
            )}
          </button>
        </div>
        <nav className="flex-1 space-y-px overflow-y-auto px-2.5">
          {NAV.map((n) => {
            const Icon = n.icon;
            const badge = badges[n.to];
            const link = (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cx(
                    "group flex h-8 items-center gap-2.5 rounded-[7px] px-2 text-[13px] transition-colors",
                    isActive ? "bg-surface text-ink shadow-[var(--shadow-sm)] font-medium" : "text-ink-2 hover:bg-surface-3/60 hover:text-ink",
                    collapsed && "justify-center px-0",
                  )
                }
              >
                <Icon className="size-[16px] shrink-0 opacity-80" strokeWidth={1.75} />
                {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
                {!collapsed && badge > 0 && <span className="min-w-[18px] rounded-full bg-danger-soft px-1.5 text-center text-[11px] font-semibold text-danger">{badge}</span>}
              </NavLink>
            );
            return collapsed ? (
              <Tip key={n.to} content={n.label} side="right">
                {link}
              </Tip>
            ) : (
              link
            );
          })}
        </nav>
        <div className="space-y-2 p-2.5">
          {app.profile === "demo" && (
            <Tip content="Estás viendo datos de demostración. Cambiá a datos reales en Settings → Datos." side="right">
              <div className={cx("flex items-center gap-2 rounded-[7px] border border-warning/40 bg-warning-soft px-2 py-1.5 text-[12px] font-semibold text-warning", collapsed && "justify-center")}>
                <FlaskConical className="size-3.5 shrink-0" />
                {!collapsed && "MODO DEMO"}
              </div>
            </Tip>
          )}
          <Menu
            align="start"
            trigger={
              <Button variant="primary" className={cx("w-full", collapsed && "w-9")} icon={<Plus className="size-4" />}>
                {!collapsed && "Acción rápida"}
              </Button>
            }
            items={[
              { label: "Registrar gasto  ⇧⌘E", onSelect: () => app.openQuick("expense") },
              { label: "Registrar ingreso  ⇧⌘I", onSelect: () => app.openQuick("income") },
              { label: "Nueva tarea  ⇧⌘T", onSelect: () => app.openQuick("task") },
              { label: "Nuevo proyecto  ⇧⌘P", onSelect: () => app.openQuick("project") },
              "sep",
              { label: "Importar CSV", onSelect: () => nav("/finance?import=1") },
              { label: "Descubrir proyectos", onSelect: () => nav("/projects?discover=1") },
            ]}
          />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {app.profile === "demo" && (
          <div role="status" className="flex h-7 shrink-0 items-center justify-center gap-2 border-b border-warning/30 bg-warning-soft text-[12px] font-medium text-warning">
            <FlaskConical className="size-3.5" /> Modo demo: todos los datos visibles son ficticios y no representan tu negocio.
          </div>
        )}
        <div className={cx("drag-region shrink-0", app.profile === "demo" ? "h-3" : native ? "h-7" : "h-3")} />
        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
          <div key={loc.pathname} className="mx-auto w-full max-w-[1320px] px-7 pb-16 pt-2 animate-fade">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      <QuickDialogs />
    </div>
  );
}
