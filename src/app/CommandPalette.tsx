import * as React from "react";
import { Command } from "cmdk";
import * as RDialog from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText, FolderKanban, ListChecks, Megaphone, Activity, GitBranch, Plus, Search, Sun, Moon, Monitor } from "lucide-react";
import { useApp, setTheme } from "./AppContext";
import { NAV } from "./nav";
import { globalSearch, type SearchHit } from "@/repos/search";
import { Kbd } from "@/components/ui/primitives";

const ICON: Record<SearchHit["type"], React.ReactNode> = {
  project: <FolderKanban className="size-4" />,
  task: <ListChecks className="size-4" />,
  transaction: <FileText className="size-4" />,
  campaign: <Megaphone className="size-4" />,
  event: <Activity className="size-4" />,
  repository: <GitBranch className="size-4" />,
};
const TYPE_LABEL: Record<SearchHit["type"], string> = { project: "Proyectos", task: "Tareas", transaction: "Transacciones", campaign: "Campañas", event: "Actividad", repository: "Repositorios" };

const item = "flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-ink-2 data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink [&_svg]:text-ink-3";

export function CommandPalette() {
  const app = useApp();
  const nav = useNavigate();
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);

  React.useEffect(() => {
    if (!app.paletteOpen) setQ("");
  }, [app.paletteOpen]);

  React.useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const r = q.trim().length >= 2 ? await globalSearch(q) : [];
      if (alive) setHits(r);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const go = (fn: () => void) => {
    app.setPaletteOpen(false);
    setTimeout(fn, 10);
  };
  const groups = Object.entries(
    hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
      (acc[h.type] ??= []).push(h);
      return acc;
    }, {}),
  );

  return (
    <RDialog.Root open={app.paletteOpen} onOpenChange={app.setPaletteOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-[60] bg-black/20 animate-fade" />
        <RDialog.Content className="fixed left-1/2 top-[14vh] z-[60] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)] animate-fade">
          <RDialog.Title className="sr-only">Buscar y ejecutar comandos</RDialog.Title>
          <RDialog.Description className="sr-only">Buscá proyectos, tareas, transacciones, campañas y eventos.</RDialog.Description>
          <Command label="Command palette" shouldFilter={q.trim().length < 2} loop>
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="size-4 text-ink-3" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Buscar proyectos, tareas, transacciones… o escribí un comando" className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3" />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[52vh] overflow-y-auto p-2">
              <Command.Empty className="py-8 text-center text-[13px] text-ink-3">Sin resultados para “{q}”.</Command.Empty>
              {groups.map(([type, list]) => (
                <Command.Group key={type} heading={TYPE_LABEL[type as SearchHit["type"]]} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
                  {list.map((h) => (
                    <Command.Item key={h.type + h.id} value={`${h.type}-${h.id}-${h.title}`} onSelect={() => go(() => nav(h.route))} className={item}>
                      {ICON[h.type]}
                      <span className="flex-1 truncate text-ink">{h.title}</span>
                      {h.subtitle && <span className="truncate text-[12px] text-ink-3">{h.subtitle}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              {q.trim().length < 2 && (
                <>
                  <Command.Group heading="Acciones rápidas" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-3">
                    {[
                      { l: "Registrar gasto", k: "⇧⌘E", f: () => app.openQuick("expense") },
                      { l: "Registrar ingreso", k: "⇧⌘I", f: () => app.openQuick("income") },
                      { l: "Nueva tarea", k: "⇧⌘T", f: () => app.openQuick("task") },
                      { l: "Nuevo proyecto", k: "⇧⌘P", f: () => app.openQuick("project") },
                      { l: "Importar transacciones (CSV)", f: () => nav("/finance?import=1") },
                      { l: "Descubrir proyectos en carpetas", f: () => nav("/projects?discover=1") },
                      { l: "Generar Weekly Business Review", f: () => nav("/ai?tab=weekly") },
                    ].map((a) => (
                      <Command.Item key={a.l} onSelect={() => go(a.f)} className={item}>
                        <Plus className="size-4" />
                        <span className="flex-1 text-ink">{a.l}</span>
                        {a.k && <Kbd>{a.k}</Kbd>}
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Ir a" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-3">
                    {NAV.map((n) => (
                      <Command.Item key={n.to} onSelect={() => go(() => nav(n.to))} className={item}>
                        <n.icon className="size-4" />
                        <span className="flex-1 text-ink">{n.label}</span>
                        {n.shortcut && <Kbd>⌘{n.shortcut}</Kbd>}
                        <ArrowRight className="size-3.5 opacity-0" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Apariencia" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-ink-3">
                    <Command.Item onSelect={() => go(() => setTheme("system"))} className={item}><Monitor className="size-4" /><span className="text-ink">Tema: automático (macOS)</span></Command.Item>
                    <Command.Item onSelect={() => go(() => setTheme("light"))} className={item}><Sun className="size-4" /><span className="text-ink">Tema: claro</span></Command.Item>
                    <Command.Item onSelect={() => go(() => setTheme("dark"))} className={item}><Moon className="size-4" /><span className="text-ink">Tema: oscuro</span></Command.Item>
                  </Command.Group>
                </>
              )}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-3">
              <span><Kbd>↑↓</Kbd> navegar</span>
              <span><Kbd>↵</Kbd> abrir</span>
              <span><Kbd>⌘B</Kbd> barra lateral</span>
              <span><Kbd>⌘1–9</Kbd> secciones</span>
            </div>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
