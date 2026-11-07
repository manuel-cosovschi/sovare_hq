import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, CircleDashed, ExternalLink, KeyRound, Loader2, Plug, RefreshCw, ShieldCheck, TriangleAlert, XCircle, Ban, Link2 } from "lucide-react";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Select, Sheet, Skeleton, Switch, type Tone } from "@/components/ui/primitives";
import { useAction, useData } from "@/app/hooks";
import { useProjects } from "@/app/queries";
import { connectorStates, saveConfig, setEnabled, syncConnector, testConnection, type ConnectorState } from "@/integrations/runner";
import { connector } from "@/integrations/registry";
import { listMappings, listRuns, setMapping } from "@/repos/integrations";
import { deleteSecret, setSecret } from "@/platform/secrets";
import { openUrl } from "@/platform/files";
import { isNative } from "@/platform/runtime";
import type { IntegrationStatus } from "@/domain/types";
import { relTime, fmtDate } from "@/lib/format";
import { cx } from "@/lib/util";
import { useToast } from "@/components/ui/feedback";

const STATUS: Record<IntegrationStatus, { label: string; tone: Tone; icon: React.ReactNode }> = {
  connected: { label: "Connected", tone: "success", icon: <CheckCircle2 className="size-3" /> },
  disconnected: { label: "Disconnected", tone: "neutral", icon: <XCircle className="size-3" /> },
  needs_setup: { label: "Needs Setup", tone: "warning", icon: <CircleDashed className="size-3" /> },
  syncing: { label: "Syncing", tone: "info", icon: <Loader2 className="size-3 animate-spin" /> },
  error: { label: "Error", tone: "danger", icon: <TriangleAlert className="size-3" /> },
  unsupported: { label: "Unsupported", tone: "neutral", icon: <Ban className="size-3" /> },
};
const CATEGORY: Record<string, string> = { development: "Desarrollo", finance: "Finanzas y pagos", marketing: "Marketing", analytics: "Analytics", hosting: "Hosting y monitoreo", ai: "Inteligencia artificial", data: "Datos" };

export default function IntegrationsPage() {
  const [params, setParams] = useSearchParams();
  const states = useData(["integrations", "states"], connectorStates, { refetchInterval: 5000 });
  const open = params.get("open");
  const groups = new Map<string, ConnectorState[]>();
  for (const s of states.data ?? []) {
    if (!groups.has(s.def.category)) groups.set(s.def.category, []);
    groups.get(s.def.category)!.push(s);
  }
  const counts = (states.data ?? []).reduce<Record<string, number>>((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {});
  return (
    <div>
      <PageHeader title="Integrations" subtitle="Conectores basados en adapters. Ninguna integración se marca como conectada sin una prueba o sincronización real." />
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(STATUS) as IntegrationStatus[]).map((k) => counts[k] ? <Badge key={k} tone={STATUS[k].tone}>{STATUS[k].icon}{STATUS[k].label}: {counts[k]}</Badge> : null)}
        {!isNative() && <Badge tone="warning">Modo navegador: algunos proveedores bloquean CORS; la app de macOS no tiene esa limitación</Badge>}
      </div>
      {states.isLoading ? <Skeleton className="h-96" /> : (
        <div className="space-y-6">
          {[...groups.entries()].map(([cat, list]) => (
            <section key={cat}>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{CATEGORY[cat] ?? cat}</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((s) => (
                  <button key={s.def.id} onClick={() => setParams({ open: s.def.id })} className="flex flex-col items-start gap-2 rounded-xl border border-line bg-surface p-4 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-line-strong">
                    <div className="flex w-full items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-[13px] font-semibold text-ink-2">{s.def.name.slice(0, 2)}</span>
                      <span className="flex-1 text-[13.5px] font-semibold">{s.def.name}</span>
                      <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].icon}{STATUS[s.status].label}</Badge>
                    </div>
                    <p className="line-clamp-2 text-[12.5px] text-ink-2">{s.def.description}</p>
                    <p className="text-[11.5px] text-ink-3">
                      {s.def.availability === "planned" ? "Adaptador previsto (no implementado)" : s.def.availability === "limited" ? "Disponible con limitaciones" : s.lastSuccessAt ? `Última sincronización ${relTime(s.lastSuccessAt)}` : s.def.sync ? "Nunca sincronizada" : "Sin sincronización automática"}
                      {s.accountLabel ? ` · ${s.accountLabel}` : ""}
                    </p>
                    {s.status === "error" && s.lastError && <p className="line-clamp-2 text-[11.5px] text-danger">{s.lastError}</p>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <ConnectorSheet id={open} state={(states.data ?? []).find((s) => s.def.id === open) ?? null} onClose={() => setParams({})} />
    </div>
  );
}

function ConnectorSheet({ id, state, onClose }: { id: string | null; state: ConnectorState | null; onClose: () => void }) {
  const def = id ? connector(id) : undefined;
  const projects = useProjects();
  const toast = useToast();
  const [secret, setSecretValue] = React.useState("");
  const [config, setConfig] = React.useState<Record<string, string>>({});
  const runs = useData(["sync_runs", id], () => listRuns(id!), { enabled: !!id });
  const mappings = useData(["mappings", id], () => listMappings(id!), { enabled: !!id });
  const [external, setExternal] = React.useState<Array<{ ref: string; label: string; hint?: string }> | null>(null);
  React.useEffect(() => {
    setConfig(state?.config ?? {});
    setSecretValue("");
    setExternal(null);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSecret = useAction(async () => {
    await setSecret(def!.secretKey!, secret);
    setSecretValue("");
    return testConnection(def!.id);
  }, { success: (r) => (r.ok ? `Credencial guardada · ${r.message}` : `Credencial guardada, pero la prueba falló: ${r.message}`) });
  const removeSecret = useAction(async () => {
    await deleteSecret(def!.secretKey!);
    await setEnabled(def!.id, false);
  }, { success: "Credencial eliminada del Llavero" });
  const save = useAction(() => saveConfig(def!.id, config), { success: "Configuración guardada" });
  const test = useAction(async () => {
    await saveConfig(def!.id, config);
    return testConnection(def!.id);
  });
  const sync = useAction(async () => {
    await saveConfig(def!.id, config);
    return syncConnector(def!.id);
  });
  const toggle = useAction((v: boolean) => setEnabled(def!.id, v));
  const map = useAction((ref: string, pid: string | null, label: string) => setMapping(def!.id, ref, pid, label), { success: "Mapeo guardado" });
  const loadExternal = async () => {
    try {
      setExternal(await def!.listExternal!({ config, cursor: null, projectFor: () => null, log: () => undefined }));
    } catch (e) {
      toast.show({ title: "No se pudieron listar los recursos", body: (e as Error).message, tone: "danger" });
    }
  };

  if (!def || !state) return null;
  const configurable = def.availability !== "planned";
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} title={def.name} subtitle={def.description} width={620} actions={<Badge tone={STATUS[state.status].tone}>{STATUS[state.status].icon}{STATUS[state.status].label}</Badge>}>
      <div className="space-y-5 text-[13px]">
        {state.status === "error" && state.lastError && <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-[12.5px] text-danger">Último error: {state.lastError}{state.retryCount > 0 && ` · ${state.retryCount} reintento(s) fallidos`}<br /><span className="text-ink-2">Los datos de esta fuente pueden estar desactualizados.</span></div>}
        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Guía de configuración</h3>
          <ol className="list-decimal space-y-1 pl-5 text-ink-2">{def.setup.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {def.docsUrl && <Button size="xs" variant="ghost" className="mt-1" icon={<ExternalLink className="size-3.5" />} onClick={() => void openUrl(def.docsUrl!)}>Documentación oficial</Button>}
        </section>
        <section>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Permisos mínimos</h3>
          <div className="flex flex-wrap gap-1.5">{def.permissions.map((p) => <Badge key={p}>{p}</Badge>)}</div>
          <p className="mt-1.5 text-[12px] text-ink-3">Autenticación: {{ token: "token / API key", oauth_token: "OAuth access token", none: "sin credenciales", folder: "carpetas autorizadas", file: "archivo elegido" }[def.auth]} · Sincronización {def.incremental ? "incremental" : "completa"}{def.syncEveryMinutes ? ` · automática cada ${def.syncEveryMinutes} min mientras la app está abierta` : ""}</p>
        </section>
        {def.secretKey && configurable && (
          <section className="rounded-xl border border-line p-3.5">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><KeyRound className="size-4 text-ink-3" />{def.secretLabel ?? "Credencial"}</h3>
            {state.hasCredential ? (
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-success" />
                <span className="flex-1 text-[12.5px] text-ink-2">Guardada en {isNative() ? "el Llavero de macOS" : "almacenamiento cifrado del navegador"}. Por seguridad no se vuelve a mostrar.</span>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => void removeSecret.run()}>Revocar</Button>
              </div>
            ) : (
              <p className="mb-2 text-[12px] text-ink-3">Se guarda en {isNative() ? "el Llavero de macOS" : "IndexedDB cifrado (AES-GCM)"}; nunca en la base de datos ni en logs. Solo se envía a: {def.secretKey && ` ${{ github: "api.github.com", vercel: "api.vercel.com", netlify: "api.netlify.com", render: "api.render.com", stripe: "api.stripe.com", mercadopago: "api.mercadopago.com", meta_ads: "graph.facebook.com", ga4: "analyticsdata.googleapis.com", openai: "api.openai.com", anthropic: "api.anthropic.com" }[def.secretKey]}`}.</p>
            )}
            <div className="mt-2 flex gap-2">
              <Input type="password" autoComplete="off" spellCheck={false} placeholder={state.hasCredential ? "Reemplazar credencial…" : "Pegá la credencial"} value={secret} onChange={(e) => setSecretValue(e.target.value)} />
              <Button variant="primary" disabled={!secret.trim()} loading={saveSecret.pending} onClick={() => void saveSecret.run()}>Guardar y probar</Button>
            </div>
          </section>
        )}
        {def.configFields.length > 0 && configurable && (
          <section className="space-y-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Configuración (no sensible)</h3>
            {def.configFields.map((f) => (
              <Field key={f.key} label={f.label + (f.required ? " *" : "")} hint={f.help}>
                {f.type === "project" ? (
                  <Select value={config[f.key] ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}><option value="">—</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                ) : f.type === "select" ? (
                  <Select value={config[f.key] ?? f.options?.[0]?.value ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                ) : (
                  <Input value={config[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
                )}
              </Field>
            ))}
            <Button size="sm" onClick={() => void save.run()}>Guardar configuración</Button>
          </section>
        )}
        {configurable && (def.test || def.sync) && (
          <section className="flex flex-wrap items-center gap-2">
            {def.test && <Button icon={<Plug className="size-3.5" />} loading={test.pending} onClick={async () => { const r = await test.run(); if (r) toast.show({ title: r.ok ? "Conexión OK" : "La prueba falló", body: r.message, tone: r.ok ? "success" : "danger" }); }}>Probar conexión</Button>}
            {def.sync && <Button variant="primary" icon={<RefreshCw className="size-3.5" />} loading={sync.pending} onClick={async () => { const r = await sync.run(); if (r) toast.show({ title: r.ok ? "Sincronización completa" : "La sincronización falló", body: r.message, tone: r.ok ? "success" : "danger" }); }}>Sincronizar ahora</Button>}
            {def.syncEveryMinutes && <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-2"><Switch checked={state.enabled} onChange={(v) => void toggle.run(v)} label="Sincronización automática" />Auto-sync</label>}
          </section>
        )}
        {def.listExternal && configurable && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3"><Link2 className="size-3.5" />Mapeo a proyectos</h3>
              <Button size="xs" onClick={() => void loadExternal()}>Listar recursos</Button>
            </div>
            {(() => {
              const rows = external ?? (mappings.data ?? []).map((m) => ({ ref: m.external_ref, label: m.external_label ?? m.external_ref, hint: undefined as string | undefined }));
              if (!rows.length) return <p className="text-[12px] text-ink-3">Listá los recursos del proveedor y asignalos a tus proyectos para evitar mezclar datos.</p>;
              return (
                <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {rows.map((r) => (
                    <li key={r.ref} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{r.label}{r.hint && <span className="text-ink-3"> · {r.hint}</span>}</span>
                      <Select className="w-44" value={(mappings.data ?? []).find((m) => m.external_ref === r.ref)?.project_id ?? ""} onChange={(e) => void map.run(r.ref, e.target.value || null, r.label)} aria-label={`Proyecto para ${r.label}`}>
                        <option value="">Sin asignar</option>
                        {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </section>
        )}
        {def.limitations.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Limitaciones reales</h3>
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink-2">{def.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </section>
        )}
        {def.sync && (
          <section>
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Historial de sincronización</h3>
            {!(runs.data ?? []).length ? <EmptyState compact title="Sin ejecuciones" /> : (
              <ul className="divide-y divide-line rounded-lg border border-line text-[12px]">
                {(runs.data ?? []).map((r) => (
                  <li key={r.id} className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <Badge tone={r.status === "success" ? "success" : r.status === "error" ? "danger" : r.status === "partial" ? "warning" : "info"}>{r.status}</Badge>
                      <span className="flex-1 text-ink-2">{fmtDate(r.started_at, "d MMM HH:mm")} · {r.items_upserted} registros</span>
                      <span className="text-ink-3">{r.finished_at ? `${Math.max(0, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000))} s` : "…"}</span>
                    </div>
                    {(r.error || r.details) && <p className={cx("mt-0.5 whitespace-pre-wrap", r.error ? "text-danger" : "text-ink-3")}>{r.error ?? r.details}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
