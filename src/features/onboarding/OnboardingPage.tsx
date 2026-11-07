import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, FolderOpen, FolderPlus, GitBranch as Github, ShieldCheck, Sparkles, Wallet, Megaphone, FileUp, FlaskConical } from "lucide-react";
import { Badge, Button, Field, Input, Select, Switch } from "@/components/ui/primitives";
import { Mark } from "@/app/Layout";
import { useApp } from "@/app/AppContext";
import { useData } from "@/app/hooks";
import { useProjects } from "@/app/queries";
import { listRoots, pickRoot } from "@/platform/folders";
import { setSecret } from "@/platform/secrets";
import { testConnection, syncConnector } from "@/integrations/runner";
import { setPref } from "@/repos/core";
import { createProject } from "@/repos/projects";
import { KNOWN_CANDIDATES, matchKnown } from "@/domain/discovery";
import { TYPE_LABEL } from "@/domain/types";
import { DEFAULT_AI, saveAiSettings } from "@/ai/settings";
import { DEFAULT_SCHED } from "@/app/scheduler";
import { DiscoveryDialog } from "@/features/projects/DiscoveryDialog";
import { cx } from "@/lib/util";
import { useToast } from "@/components/ui/feedback";
import { seedDemo } from "@/demo/seed";

const STEPS = ["Bienvenida", "Carpetas", "GitHub", "Proyectos", "Moneda", "Fuentes", "IA y privacidad", "Listo"];

export default function OnboardingPage() {
  const app = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = React.useState(0);
  const roots = useData(["fs-roots"], listRoots);
  const projects = useProjects();
  const [token, setToken] = React.useState("");
  const [gh, setGh] = React.useState<string | null>(null);
  const [discover, setDiscover] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [currency, setCurrency] = React.useState("USD");
  const [autoSync, setAutoSync] = React.useState(true);
  const [notifications, setNotifications] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      for (const name of picked) {
        const k = KNOWN_CANDIDATES.find((c) => c.name === name)!;
        await createProject({ name: k.name, description: k.description, type: k.type, category: k.category, status: "idea" });
      }
      await setPref("finance.reporting_currency", currency);
      app.setReportingCurrency(currency);
      await setPref("scheduler", { ...DEFAULT_SCHED, autoSync, notifications });
      await saveAiSettings(DEFAULT_AI);
      await setPref("onboarding.completed", true);
      window.dispatchEvent(new Event("sovare:onboarded"));
      nav("/", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const connectGithub = async () => {
    setBusy(true);
    try {
      await setSecret("github", token);
      setToken("");
      const r = await testConnection("github");
      setGh(r.message);
      if (r.ok) {
        toast.show({ title: r.message, tone: "success" });
        void syncConnector("github");
      } else toast.show({ title: "No se pudo verificar el token", body: r.message, tone: "danger" });
    } catch (e) {
      toast.show({ title: "Error", body: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const registered = new Set((projects.data ?? []).map((p) => matchKnown(p.name)).filter(Boolean));
  const body = [
    <div key="0" className="text-center">
      <div className="mx-auto mb-5 w-fit"><Mark size={72} /></div>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Bienvenido a Sovare HQ</h1>
      <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-2">Tu centro de control para proyectos, finanzas, publicidad, desarrollo y prioridades. Local-first: tus datos viven en esta Mac.</p>
      <div className="mx-auto mt-6 grid max-w-lg grid-cols-3 gap-3 text-left text-[12.5px]">
        {[["Datos reales", "Nunca se inventan métricas: lo desconocido se marca como “Sin datos”."], ["Privado", "Credenciales en el Llavero. Nada sale sin tu autorización."], ["Opcional", "Podés omitir cualquier integración y configurarla después."]].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-line bg-surface p-3"><p className="font-semibold">{t}</p><p className="mt-1 text-ink-3">{d}</p></div>
        ))}
      </div>
      <button className="mt-6 inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink" onClick={async () => { await app.switchProfile("demo"); await seedDemo(); await app.switchProfile("demo"); }}>
        <FlaskConical className="size-3.5" />Prefiero explorar primero con datos de demostración
      </button>
    </div>,
    <div key="1">
      <StepTitle icon={<FolderOpen />} title="Elegí carpetas de proyectos" body="Sovare HQ solo lee manifests y metadatos Git dentro de las carpetas que autorices. Nunca modifica tus repositorios ni explora el resto de tu Mac." />
      <ul className="mb-3 space-y-1.5">
        {(roots.data ?? []).map((r) => <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px]"><Check className="size-3.5 text-success" />{r.path}</li>)}
      </ul>
      <Button icon={<FolderPlus className="size-4" />} onClick={async () => { try { await pickRoot(); void roots.refetch(); } catch (e) { toast.show({ title: "No se pudo agregar", body: (e as Error).message, tone: "danger" }); } }}>Agregar carpeta</Button>
    </div>,
    <div key="2">
      <StepTitle icon={<Github />} title="Conectá GitHub (opcional)" body="Usá un fine-grained token de solo lectura (Metadata, Contents, Issues, Pull requests, Actions). Se guarda en el Llavero de macOS y nunca vuelve a mostrarse." />
      {gh ? <Badge tone="success"><Check className="size-3" />{gh}</Badge> : (
        <div className="flex gap-2">
          <Input type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button variant="primary" disabled={!token.trim()} loading={busy} onClick={() => void connectGithub()}>Conectar</Button>
        </div>
      )}
    </div>,
    <div key="3">
      <StepTitle icon={<Sparkles />} title="Revisá y confirmá tus proyectos" body="Escaneá las carpetas autorizadas o registrá candidatos conocidos. Ningún candidato se asume terminado, facturando ni desplegado." />
      <Button className="mb-4" disabled={!(roots.data ?? []).length} onClick={() => setDiscover(true)}>Escanear carpetas autorizadas ({(roots.data ?? []).length})</Button>
      <p className="mb-2 text-[12.5px] font-medium text-ink-2">Candidatos conocidos (se crean como “Idea”, editables después)</p>
      <div className="grid grid-cols-2 gap-1.5">
        {KNOWN_CANDIDATES.map((k) => (
          <label key={k.name} className={cx("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[12.5px]", registered.has(k.name) ? "border-line opacity-60" : picked.has(k.name) ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
            <input type="checkbox" disabled={registered.has(k.name)} checked={picked.has(k.name) || registered.has(k.name)} onChange={(e) => { const s = new Set(picked); if (e.target.checked) s.add(k.name); else s.delete(k.name); setPicked(s); }} />
            <span className="flex-1">{k.name}</span>
            <span className="text-[11px] text-ink-3">{registered.has(k.name) ? "ya registrado" : TYPE_LABEL[k.type]}</span>
          </label>
        ))}
      </div>
      <DiscoveryDialog open={discover} onClose={() => setDiscover(false)} />
    </div>,
    <div key="4">
      <StepTitle icon={<Wallet />} title="Moneda principal" body="Los importes se guardan siempre en su moneda original (ARS o USD). La moneda principal se usa para consolidar, solo con tipos de cambio explícitos (fuente y fecha)." />
      <Field label="Moneda principal" className="w-48"><Select value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="USD">USD · Dólar</option><option value="ARS">ARS · Peso argentino</option></Select></Field>
    </div>,
    <div key="5">
      <StepTitle icon={<Megaphone />} title="Fuentes financieras y comerciales" body="Opcional. Podés conectarlas ahora desde Integrations o más tarde. Todas funcionan en modo lectura." />
      <ul className="space-y-2 text-[13px]">
        {[["Mercado Pago", "Pagos, comisiones y reembolsos"], ["Stripe", "Cobros, comisiones y MRR"], ["Meta Ads", "Campañas y métricas"], ["Vercel / Netlify", "Despliegues"], ["Importación CSV", "Bancos y planillas, sin credenciales"]].map(([n, d]) => (
          <li key={n} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2"><FileUp className="size-4 text-ink-3" /><span className="flex-1"><b className="font-medium">{n}</b> <span className="text-ink-3">· {d}</span></span><Badge>Después</Badge></li>
        ))}
      </ul>
    </div>,
    <div key="6">
      <StepTitle icon={<ShieldCheck />} title="IA, privacidad y sincronización" body="Por defecto: sin proveedor de IA externo y sin enviar datos a terceros. El motor local de recomendaciones funciona igual. Podés cambiarlo en Settings." />
      <div className="space-y-2 rounded-xl border border-line bg-surface p-3 text-[13px]">
        <label className="flex items-center justify-between"><span>Sincronizar integraciones automáticamente mientras la app está abierta</span><Switch checked={autoSync} onChange={setAutoSync} label="Auto-sync" /></label>
        <label className="flex items-center justify-between"><span>Notificaciones nativas de macOS para alertas importantes</span><Switch checked={notifications} onChange={setNotifications} label="Notificaciones" /></label>
        <p className="text-[12px] text-ink-3">Análisis con IA externa: desactivado. Activalo y elegí categorías en Settings → IA y privacidad.</p>
      </div>
    </div>,
    <div key="7" className="text-center">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success-soft"><Check className="size-7 text-success" /></div>
      <h2 className="text-[22px] font-semibold">Todo listo</h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] text-ink-2">Abrí el dashboard. Las secciones sin datos te van a indicar qué conectar o registrar. ⌘K abre la búsqueda global.</p>
    </div>,
  ];

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="drag-region h-10 shrink-0" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-8">
        <ol className="mb-8 flex items-center gap-1.5" aria-label="Pasos">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 flex-col gap-1">
              <span className={cx("h-1 rounded-full", i <= step ? "bg-primary" : "bg-line")} />
              <span className={cx("text-[10.5px]", i === step ? "font-medium text-ink" : "text-ink-3")}>{s}</span>
            </li>
          ))}
        </ol>
        <div key={step} className="flex-1 animate-fade">{body[step]}</div>
        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" icon={<ArrowLeft className="size-4" />} disabled={step === 0} onClick={() => setStep(step - 1)}>Atrás</Button>
          <div className="flex gap-2">
            {step < STEPS.length - 1 && <Button variant="ghost" onClick={() => void finish()}>Omitir y abrir dashboard</Button>}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep(step + 1)}>{[1, 2, 5].includes(step) ? "Continuar (opcional)" : "Continuar"}<ArrowRight className="size-4" /></Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={() => void finish()}>Abrir dashboard</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepTitle({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="mb-5">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-surface-3 text-ink-2 [&_svg]:size-5">{icon}</div>
      <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
      <p className="mt-1 text-[13.5px] text-ink-2">{body}</p>
    </div>
  );
}
