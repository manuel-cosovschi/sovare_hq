import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Database, Download, FlaskConical, HardDriveDownload, Monitor, Moon, RotateCcw, Sun, Upload, ShieldCheck, Bell, KeyRound } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Segmented, Switch, Tabs } from "@/components/ui/primitives";
import { useApp, readTheme, setTheme, type ThemePref } from "@/app/AppContext";
import { useAction, useData } from "@/app/hooks";
import { getPref, setPref } from "@/repos/core";
import { RULES, ruleConfigs, saveRuleConfig } from "@/repos/alerts";
import { defaultParams } from "@/domain/alertRules";
import { DEFAULT_SCHED, type SchedulerPrefs } from "@/app/scheduler";
import { loadAiSettings, saveAiSettings, DATA_CATEGORIES, MODEL_PLACEHOLDER, isExternal, type AiSettings, type AiProvider, type DataCategory } from "@/ai/settings";
import { testProvider } from "@/ai/providers";
import { TOOLS } from "@/ai/tools";
import { secretStatus, setSecret, deleteSecret } from "@/platform/secrets";
import { appInfo, nativeBackup, nativeRestore, notificationPermission, requestNotificationPermission } from "@/platform/notify";
import { isNative, platformLabel } from "@/platform/runtime";
import { saveFile } from "@/platform/files";
import { activeLocation, browserBackup, browserRestore } from "@/db";
import { exportAllJson, resetDemo, seedDemo } from "@/demo/seed";
import { SUPPORTED_CURRENCIES } from "@/domain/money";
import { todayStr } from "@/lib/util";
import { useToast } from "@/components/ui/feedback";

type Tab = "general" | "ai" | "alerts" | "data" | "about";

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "general";
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: "general", label: "General" }, { value: "ai", label: "IA y privacidad" }, { value: "alerts", label: "Alertas y automatizaciones" }, { value: "data", label: "Datos, backup y demo" }, { value: "about", label: "Acerca de" }]} />
      <div className="max-w-3xl space-y-4">
        {tab === "general" && <General />}
        {tab === "ai" && <AiSettingsTab />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "data" && <DataTab />}
        {tab === "about" && <About />}
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line px-4 py-3 last:border-0">
      <div>
        <p className="text-[13px] font-medium">{title}</p>
        {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function General() {
  const app = useApp();
  const [theme, setT] = React.useState<ThemePref>(readTheme());
  const sched = useData(["prefs", "scheduler"], () => getPref<Partial<SchedulerPrefs>>("scheduler", {}));
  const s = { ...DEFAULT_SCHED, ...(sched.data ?? {}) };
  const saveSched = useAction((p: SchedulerPrefs) => setPref("scheduler", p));
  const perm = useData(["notif-perm"], notificationPermission);
  return (
    <>
      <Card>
        <CardHeader title="Apariencia" />
        <Row title="Tema" hint="Automático sigue la apariencia de macOS">
          <Segmented value={theme} onChange={(v) => (setT(v), setTheme(v))} options={[{ value: "system", label: <span className="flex items-center gap-1"><Monitor className="size-3.5" />Auto</span> }, { value: "light", label: <span className="flex items-center gap-1"><Sun className="size-3.5" />Claro</span> }, { value: "dark", label: <span className="flex items-center gap-1"><Moon className="size-3.5" />Oscuro</span> }]} />
        </Row>
        <Row title="Moneda principal" hint="Usada para consolidar (con tipo de cambio explícito) y como valor por defecto">
          <Select className="w-28" value={app.reportingCurrency} onChange={(e) => app.setReportingCurrency(e.target.value)}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </Row>
      </Card>
      <Card>
        <CardHeader title="Sincronización y notificaciones" subtitle="Todo esto se ejecuta solo mientras Sovare HQ está abierta (ventana, minimizada o en la barra de menú). No hay servicio en segundo plano instalado." />
        <Row title="Sincronización automática de integraciones" hint="Cada integración habilitada sincroniza según su intervalo, con backoff ante errores">
          <Switch checked={s.autoSync} onChange={(v) => void saveSched.run({ ...s, autoSync: v })} label="Sincronización automática" />
        </Row>
        <Row title="Evaluar reglas de alertas cada" hint="Además de después de cada sincronización">
          <Select className="w-32" value={String(s.alertsEveryMinutes)} onChange={(e) => void saveSched.run({ ...s, alertsEveryMinutes: Number(e.target.value) })}>{[1, 5, 15, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</Select>
        </Row>
        <Row title="Notificaciones nativas de macOS" hint={perm.data === "granted" ? "Permiso concedido" : "Se piden permisos al activarlas"}>
          <div className="flex items-center gap-2">
            {perm.data !== "granted" && <Button size="sm" icon={<Bell className="size-3.5" />} onClick={async () => { await requestNotificationPermission(); void perm.refetch(); }}>Pedir permiso</Button>}
            <Switch checked={s.notifications} onChange={(v) => void saveSched.run({ ...s, notifications: v })} label="Notificaciones" />
          </div>
        </Row>
      </Card>
    </>
  );
}

function AiSettingsTab() {
  const toast = useToast();
  const loaded = useData(["ai-settings"], loadAiSettings);
  const [s, setS] = React.useState<AiSettings | null>(null);
  const [key, setKey] = React.useState("");
  const keys = useData(["secrets", "ai"], () => secretStatus(["openai", "anthropic"]));
  React.useEffect(() => { if (loaded.data) setS(loaded.data); }, [loaded.data]);
  const save = useAction(async (next: AiSettings) => saveAiSettings(next), { success: "Preferencias de IA guardadas" });
  const storeKey = useAction(async () => { await setSecret(s!.provider as "openai", key); setKey(""); void keys.refetch(); }, { success: "API key guardada" });
  const delKey = useAction(async () => { await deleteSecret(s!.provider as "openai"); void keys.refetch(); }, { success: "API key eliminada" });
  if (!s) return null;
  const update = (patch: Partial<AiSettings>) => setS({ ...s, ...patch });
  const ext = isExternal(s);
  return (
    <>
      <Card>
        <CardHeader title="Proveedor de IA" subtitle="Opcional. Las recomendaciones del motor local funcionan siempre, sin API de pago." />
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Field label="Proveedor">
            <Select value={s.provider} onChange={(e) => update({ provider: e.target.value as AiProvider, model: "" })}>
              <option value="none">Ninguno (solo motor local)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="ollama">Modelo local (Ollama / LM Studio, API compatible OpenAI)</option>
            </Select>
          </Field>
          {s.provider !== "none" && <Field label="Modelo" hint="El modelo debe soportar tool calling"><Input value={s.model} placeholder={MODEL_PLACEHOLDER[s.provider]} onChange={(e) => update({ model: e.target.value })} /></Field>}
          {s.provider === "ollama" && <Field label="URL del servidor" className="col-span-2" hint="Local = los datos no salen de tu Mac"><Input value={s.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} /></Field>}
          {(s.provider === "openai" || s.provider === "anthropic") && (
            <div className="col-span-2">
              <Field label="API key" hint={keys.data?.[s.provider] ? "Guardada en el Llavero. No se vuelve a mostrar." : "Se guarda en el Llavero de macOS (write-only)."}>
                <div className="flex gap-2">
                  <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={keys.data?.[s.provider] ? "••••••••  (reemplazar)" : "Pegá tu API key"} />
                  <Button disabled={!key} onClick={() => void storeKey.run()} icon={<KeyRound className="size-3.5" />}>Guardar</Button>
                  {keys.data?.[s.provider] && <Button variant="ghost" className="text-danger" onClick={() => void delKey.run()}>Eliminar</Button>}
                </div>
              </Field>
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <Button variant="primary" onClick={() => void save.run(s)}>Guardar</Button>
          {s.provider !== "none" && <Button onClick={async () => { await save.run(s); try { toast.show({ title: await testProvider(s), tone: "success" }); } catch (e) { toast.show({ title: "La prueba falló", body: (e as Error).message, tone: "danger" }); } }}>Probar proveedor</Button>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Privacidad" icon={<ShieldCheck className="size-4 text-accent" />} subtitle="Nada se envía automáticamente. El asistente solo accede a las categorías habilitadas, a través de herramientas internas validadas." />
        <Row title="Permitir análisis externo" hint={ext ? "Requerido para enviar datos a un proveedor en la nube (o servidor no local)" : "El proveedor elegido es local: los datos no salen de tu Mac"}>
          <Switch checked={s.externalEnabled} onChange={(v) => { const n = { ...s, externalEnabled: v }; setS(n); void save.run(n); }} label="Análisis externo" />
        </Row>
        <div className="px-4 py-3">
          <p className="mb-2 text-[12.5px] font-medium">Categorías de información que el asistente puede consultar</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(DATA_CATEGORIES) as DataCategory[]).map((c) => (
              <label key={c} className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-[12.5px]">
                <input type="checkbox" className="mt-0.5" checked={s.categories[c]} onChange={(e) => { const n = { ...s, categories: { ...s.categories, [c]: e.target.checked } }; setS(n); void save.run(n); }} />
                <span><span className="font-medium">{DATA_CATEGORIES[c]}</span><br /><span className="text-[11.5px] text-ink-3">Herramientas: {TOOLS.filter((t) => t.category === c).map((t) => t.name).join(", ")}</span></span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-ink-3">Los tokens de integraciones nunca se incluyen en prompts, herramientas ni logs. Cada respuesta del asistente muestra qué herramientas (datos) consultó.</p>
        </div>
      </Card>
    </>
  );
}

function AlertsTab() {
  const cfg = useData(["alert-rules"], ruleConfigs);
  const save = useAction((id: string, c: { enabled: boolean; notify: boolean; params: Record<string, number> }) => saveRuleConfig(id, c), { success: "Regla actualizada" });
  return (
    <Card>
      <CardHeader title="Motor de reglas" subtitle="Cada alerta se basa en datos registrados y reglas verificables. Configurá umbrales y notificaciones." />
      {RULES.map((r) => {
        const c = cfg.data?.[r.id];
        const current = { enabled: c?.enabled ?? true, notify: c?.notify ?? true, params: { ...defaultParams(r), ...(c?.params ?? {}) } };
        return (
          <div key={r.id} className="border-b border-line px-4 py-3 last:border-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] font-medium">{r.name}</p>
                <p className="text-[12px] text-ink-3">{r.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="flex items-center gap-1.5 text-[12px] text-ink-2"><Switch checked={current.notify} onChange={(v) => void save.run(r.id, { ...current, notify: v })} label="Notificar" />Notificar</label>
                <Switch checked={current.enabled} onChange={(v) => void save.run(r.id, { ...current, enabled: v })} label="Activa" />
              </div>
            </div>
            {r.params.length > 0 && current.enabled && (
              <div className="mt-2 flex flex-wrap gap-3">
                {r.params.map((p) => (
                  <Field key={p.key} label={p.label} className="w-56">
                    <Input type="number" min={p.min} defaultValue={current.params[p.key]} onBlur={(e) => { const v = Number(e.target.value); if (isFinite(v) && v !== current.params[p.key]) void save.run(r.id, { ...current, params: { ...current.params, [p.key]: v } }); }} />
                  </Field>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="px-4 py-3 text-[11.5px] text-ink-3">Verificaciones: (1) mientras la app está abierta — todas las reglas; (2) servicio en segundo plano — no instalado en esta versión; (3) con la Mac apagada — requiere un servidor externo (no incluido). Ver docs/LIMITATIONS.md.</p>
    </Card>
  );
}

function DataTab() {
  const app = useApp();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const backup = async () => {
    try {
      if (isNative()) {
        const r = await nativeBackup(`sovare-hq-${app.profile}-${todayStr()}.sqlite`);
        if (r) toast.show({ title: r.integrity === "ok" ? "Backup verificado" : "Backup creado con advertencias", body: `${r.path} · ${(r.bytes / 1024).toFixed(0)} KB · integrity_check: ${r.integrity}`, tone: r.integrity === "ok" ? "success" : "warning" });
      } else {
        const bytes = browserBackup()?.();
        if (!bytes) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/x-sqlite3" }));
        a.download = `sovare-hq-${app.profile}-${todayStr()}.sqlite`;
        a.click();
      }
    } catch (e) {
      toast.show({ title: "No se pudo crear el backup", body: (e as Error).message, tone: "danger" });
    }
  };
  const restore = async () => {
    if (!(await toast.confirm({ title: "¿Restaurar un backup?", body: "Los datos actuales se reemplazan. Antes se guarda una copia de seguridad automática del estado actual.", confirmLabel: "Elegir archivo…", danger: true }))) return;
    if (!isNative()) return fileRef.current?.click();
    try {
      const safety = await nativeRestore();
      if (safety) {
        toast.show({ title: "Backup restaurado", body: `Copia previa guardada en ${safety}`, tone: "success" });
        await app.switchProfile(app.profile);
      }
    } catch (e) {
      toast.show({ title: "No se pudo restaurar", body: (e as Error).message, tone: "danger" });
    }
  };
  const switchDemo = async (on: boolean) => {
    setBusy(true);
    try {
      await app.switchProfile(on ? "demo" : "main");
      if (on) await seedDemo();
      await app.switchProfile(on ? "demo" : "main");
    } finally {
      setBusy(false);
    }
  };
  const reset = useAction(() => resetDemo(), { success: "Demo reiniciada" });
  return (
    <>
      <Card>
        <CardHeader title="Modo demo" icon={<FlaskConical className="size-4 text-warning" />} subtitle="Usa una base de datos separada con datos ficticios para probar todos los módulos. Tus datos reales nunca se mezclan." />
        <Row title={app.profile === "demo" ? "Estás en MODO DEMO" : "Datos reales"} hint={app.profile === "demo" ? "Banner visible en todas las pantallas" : "Sin datos inventados: lo desconocido aparece como “Sin datos”"}>
          <div className="flex items-center gap-2">
            {app.profile === "demo" && <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => void reset.run()}>Reiniciar demo</Button>}
            <Button size="sm" variant={app.profile === "demo" ? "primary" : "secondary"} loading={busy} onClick={() => void switchDemo(app.profile !== "demo")}>{app.profile === "demo" ? "Volver a datos reales" : "Abrir modo demo"}</Button>
          </div>
        </Row>
      </Card>
      <Card>
        <CardHeader title="Backup & Restore" icon={<Database className="size-4 text-ink-3" />} subtitle="Copia consistente de la base SQLite verificada con integrity_check. Las credenciales no se incluyen (viven en el Llavero)." />
        <Row title="Ubicación de la base de datos" hint={<span className="font-mono">{activeLocation()}</span>}><Badge>{app.profile}</Badge></Row>
        <Row title="Crear backup"><Button size="sm" icon={<HardDriveDownload className="size-3.5" />} onClick={() => void backup()}>Guardar backup…</Button></Row>
        <Row title="Restaurar backup" hint="Se valida el archivo antes de reemplazar"><Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => void restore()}>Restaurar…</Button></Row>
        <Row title="Exportar todos los datos (JSON)" hint="Para análisis externo o migración"><Button size="sm" icon={<Download className="size-3.5" />} onClick={async () => { const p = await saveFile(`sovare-hq-export-${todayStr()}.json`, await exportAllJson(), "json"); if (p) toast.show({ title: "Exportado", body: p, tone: "success" }); }}>Exportar</Button></Row>
        <input ref={fileRef} type="file" accept=".sqlite,.db" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            await browserRestore()?.(new Uint8Array(await f.arrayBuffer()));
            toast.show({ title: "Backup restaurado", tone: "success" });
            await app.switchProfile(app.profile);
          } catch (err) {
            toast.show({ title: "No se pudo restaurar", body: (err as Error).message, tone: "danger" });
          }
        }} />
      </Card>
    </>
  );
}

function About() {
  const info = useData(["app-info"], appInfo);
  return (
    <Card>
      <CardHeader title="Sovare HQ" subtitle="Centro de control personal · local-first · monousuario" />
      <Row title="Versión">{info.data?.version ?? "—"}</Row>
      <Row title="Plataforma">{platformLabel()} · {info.data?.platform}</Row>
      <Row title="Datos de la app" hint={<span className="font-mono">{info.data?.data_dir}</span>}>{" "}</Row>
      <Row title="Atajos" hint="⌘K buscar · ⌘1–9/0 secciones · ⌘, ajustes · ⌘B barra lateral · ⇧⌘E gasto · ⇧⌘I ingreso · ⇧⌘T tarea · ⇧⌘P proyecto">{" "}</Row>
    </Card>
  );
}
