import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bot, Download, FileText, Lock, RefreshCw, Send, Sparkles, Trash2, User, Wand2, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, Tabs, Textarea } from "@/components/ui/primitives";
import { Markdown } from "@/components/Markdown";
import { useApp } from "@/app/AppContext";
import { useAction, useData } from "@/app/hooks";
import { generateInsights, answerPreset, PRESET_QUESTIONS, type Insight } from "@/ai/localEngine";
import { buildDailyBrief } from "@/ai/brief";
import { buildWeeklyReview, type WeeklyReview } from "@/ai/weekly";
import { weeklyReviewPdf } from "@/ai/pdf";
import { askAssistant, narrate } from "@/ai/assistant";
import { assistantAvailability, isExternal, loadAiSettings } from "@/ai/settings";
import { listInsights, saveInsight, addMessage, listMessages, clearConversation } from "@/repos/ai";
import { saveFile } from "@/platform/files";
import { formatMoney } from "@/domain/money";
import { fmtDate, relTime } from "@/lib/format";
import { cx, todayStr } from "@/lib/util";
import { useToast } from "@/components/ui/feedback";

type Tab = "insights" | "ask" | "brief" | "weekly";

export default function AiPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "insights";
  const settings = useData(["ai-settings"], loadAiSettings);
  const nav = useNavigate();
  const s = settings.data;
  const avail = s ? assistantAvailability(s) : { ok: false };
  return (
    <div>
      <PageHeader
        title="AI Insights"
        subtitle="Recomendaciones con razón, evidencia y nivel de confianza. Hechos, estimaciones e hipótesis siempre diferenciados."
        actions={
          <Button size="sm" variant="ghost" icon={<ShieldCheck className="size-4" />} onClick={() => nav("/settings?tab=ai")}>
            {s?.provider && s.provider !== "none" ? `${s.provider}${isExternal(s) ? (s.externalEnabled ? " · externo activo" : " · externo desactivado") : " · local"}` : "Solo motor local"}
          </Button>
        }
      />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: "insights", label: "Recomendaciones" }, { value: "ask", label: "Preguntar" }, { value: "brief", label: "Daily AI Brief" }, { value: "weekly", label: "Weekly Business Review" }]} />
      {tab === "insights" && <InsightsTab />}
      {tab === "ask" && <AskTab available={avail.ok} reason={"reason" in avail ? avail.reason : undefined} />}
      {tab === "brief" && <BriefTab available={avail.ok} />}
      {tab === "weekly" && <WeeklyTab available={avail.ok} />}
    </div>
  );
}

export function InsightCard({ i }: { i: Insight }) {
  const nav = useNavigate();
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">{i.recommendation}</p>
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-ink-3">Razón</dt><dd>{i.reason}</dd>
            {i.evidence.length > 0 && (<><dt className="text-ink-3">Evidencia</dt><dd className="text-ink-2">{i.evidence.join(" · ")}</dd></>)}
            <dt className="text-ink-3">Impacto</dt><dd className="text-ink-2">{i.impact ?? "No estimable con los datos actuales"}</dd>
            <dt className="text-ink-3">Acción sugerida</dt><dd>{i.action}</dd>
          </dl>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={i.type === "hecho" ? "info" : i.type === "estimación" ? "accent" : "neutral"}>{i.type}</Badge>
          <Badge tone={i.confidence === "alta" ? "success" : i.confidence === "media" ? "warning" : "neutral"}>confianza {i.confidence}</Badge>
          {i.link && <Button size="xs" variant="ghost" onClick={() => (i.link!.startsWith("/") ? nav(i.link!) : window.open(i.link!))}>Ver</Button>}
        </div>
      </div>
    </Card>
  );
}

function InsightsTab() {
  const insights = useData(["insights"], () => generateInsights());
  const [topic, setTopic] = React.useState<string>("");
  const topics: Record<string, string> = { priority: "Prioridades", operations: "Operaciones", finance: "Finanzas", marketing: "Marketing", development: "Desarrollo", data: "Datos faltantes" };
  const list = (insights.data ?? []).filter((i) => !topic || i.topic === topic);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setTopic("")} className={cx("h-7 rounded-md px-2.5 text-[12.5px]", !topic ? "bg-primary text-primary-fg" : "bg-surface-3 text-ink-2")}>Todas ({insights.data?.length ?? 0})</button>
        {Object.entries(topics).map(([k, v]) => {
          const n = (insights.data ?? []).filter((i) => i.topic === k).length;
          return n ? <button key={k} onClick={() => setTopic(k)} className={cx("h-7 rounded-md px-2.5 text-[12.5px]", topic === k ? "bg-primary text-primary-fg" : "bg-surface-3 text-ink-2")}>{v} ({n})</button> : null;
        })}
        <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw className="size-3.5" />} onClick={() => void insights.refetch()}>Recalcular</Button>
      </div>
      <p className="text-[12px] text-ink-3">Motor local de reglas: no requiere API de pago ni envía datos fuera de tu Mac.</p>
      {insights.isLoading ? <Skeleton className="h-64" /> : !list.length ? <Card><EmptyState icon={<Sparkles />} title="Sin recomendaciones" body="No hay suficiente información todavía." /></Card> : list.map((i) => <InsightCard key={i.id} i={i} />)}
    </div>
  );
}

function AskTab({ available, reason }: { available: boolean; reason?: string }) {
  const nav = useNavigate();
  const toast = useToast();
  const conv = "main";
  const messages = useData(["ai-messages", conv], () => listMessages(conv));
  const [preset, setPreset] = React.useState<string | null>(null);
  const answer = useData(["preset", preset], () => answerPreset(preset!), { enabled: !!preset });
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const clear = useAction(() => clearConversation(conv));
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages.data?.length, busy]);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    const settings = await loadAiSettings();
    setBusy(true);
    setQ("");
    await addMessage(conv, "user", question);
    await messages.refetch();
    try {
      const history = (messages.data ?? []).map((m) => ({ role: m.role, content: m.content }));
      const r = await askAssistant(settings, history, question);
      await addMessage(conv, "assistant", r.answer, { tools: r.trace.map((t) => ({ name: t.tool, args: t.args })), provider: settings.provider });
    } catch (e) {
      await addMessage(conv, "assistant", `No pude completar el análisis: ${(e as Error).message}`, { error: true });
      toast.show({ title: "Error del proveedor de IA", body: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
      await messages.refetch();
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3">
        <Card>
          <CardHeader title="Preguntas frecuentes" subtitle="Respondidas por el motor local con evidencia (sin IA externa)" />
          <div className="flex flex-col gap-1 px-2 pb-3">
            {PRESET_QUESTIONS.map((p) => (
              <button key={p.id} onClick={() => setPreset(p.id)} className={cx("rounded-lg px-2.5 py-2 text-left text-[13px]", preset === p.id ? "bg-accent-soft font-medium" : "hover:bg-surface-2")}>{p.q}</button>
            ))}
          </div>
        </Card>
        {preset && (
          <div className="space-y-2">
            {answer.isLoading ? <Skeleton className="h-32" /> : answer.data?.empty ? (
              <Card className="p-4 text-[13px] text-ink-2">{answer.data.empty}</Card>
            ) : (answer.data?.insights ?? []).map((i) => <InsightCard key={i.id} i={i} />)}
          </div>
        )}
      </div>
      <Card className="flex min-h-[560px] flex-col">
        <CardHeader title="Asistente" icon={<Bot className="size-4 text-accent" />} subtitle="Consulta tus datos mediante herramientas internas tipadas y autorizadas" actions={!!messages.data?.length && <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void clear.run()}>Limpiar</Button>} />
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
          {!available && (
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-[12.5px] text-ink-2">
              <p className="mb-1 flex items-center gap-1.5 font-medium"><Lock className="size-3.5" />Asistente conversacional no disponible</p>
              <p>{reason}</p>
              <Button size="sm" className="mt-2" onClick={() => nav("/settings?tab=ai")}>Configurar IA y privacidad</Button>
            </div>
          )}
          {(messages.data ?? []).map((m) => (
            <div key={m.id} className={cx("flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
              <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-full", m.role === "user" ? "bg-primary text-primary-fg" : "bg-accent-soft text-accent")}>{m.role === "user" ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}</span>
              <div className={cx("max-w-[85%] rounded-xl px-3 py-2", m.role === "user" ? "bg-primary text-primary-fg" : "bg-surface-2")}>
                {m.role === "user" ? <p className="selectable text-[13px]">{m.content}</p> : <Markdown text={m.content} />}
                {!!m.meta?.tools?.length && <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-ink-3">Datos consultados: {m.meta.tools.map((t) => t.name).join(", ")}</p>}
              </div>
            </div>
          ))}
          {busy && <p className="flex items-center gap-2 text-[12.5px] text-ink-3"><Sparkles className="size-3.5 animate-pulse" />Analizando con herramientas internas…</p>}
          <div ref={endRef} />
        </div>
        <div className="border-t border-line p-3">
          <div className="flex gap-2">
            <Textarea rows={2} className="min-h-12" disabled={!available || busy} value={q} onChange={(e) => setQ(e.target.value)} placeholder={available ? "¿Qué proyecto debería priorizar esta semana?" : "Configurá un proveedor de IA para conversar"} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }} />
            <Button variant="primary" icon={<Send className="size-4" />} disabled={!available || busy || !q.trim()} onClick={() => void ask(q)} aria-label="Enviar" />
          </div>
        </div>
      </Card>
    </div>
  );
}

function BriefTab({ available }: { available: boolean }) {
  const app = useApp();
  const brief = useData(["brief", app.previousVisit], () => buildDailyBrief(app.previousVisit));
  const stored = useData(["ai-insights", "daily_brief"], () => listInsights<{ text: string }>("daily_brief", 5));
  const gen = useAction(async () => {
    const s = await loadAiSettings();
    const text = await narrate(s, "resumen diario (Daily Brief)", { brief: brief.data, today: todayStr() });
    await saveInsight("daily_brief", s.provider, `Brief ${todayStr()}`, { text });
  }, { success: "Brief generado" });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Qué cambió" subtitle={app.previousVisit ? `Desde ${relTime(app.previousVisit)}` : "Últimas 24 h"} />
        <div className="px-4 pb-4">
          {!brief.data ? <Skeleton className="h-24" /> : brief.data.empty ? <p className="text-[13px] text-ink-2">No hay métricas ni actividades nuevas desde tu última visita.</p> : <ul className="space-y-1.5 text-[13px]">{brief.data.lines.map((l, i) => <li key={i}>• {l}</li>)}</ul>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Brief redactado con IA" subtitle="Solo se envía el resumen calculado (no tus transacciones)" actions={<Button size="sm" icon={<Wand2 className="size-3.5" />} disabled={!available || !brief.data || brief.data.empty} loading={gen.pending} onClick={() => void gen.run()}>Generar</Button>} />
        <div className="space-y-3 px-4 pb-4">
          {!available && <p className="text-[12.5px] text-ink-3">Requiere un proveedor de IA habilitado. El brief local de la izquierda siempre está disponible.</p>}
          {brief.data?.empty && <p className="text-[12.5px] text-ink-3">No se genera un brief cuando no hay información nueva.</p>}
          {(stored.data ?? []).map((s) => (
            <div key={s.id} className="rounded-lg border border-line p-3">
              <p className="mb-1 text-[11.5px] text-ink-3">{fmtDate(s.created_at, "d MMM HH:mm")} · {s.provider}</p>
              <Markdown text={s.content?.text ?? ""} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function WeeklyTab({ available }: { available: boolean }) {
  const toast = useToast();
  const stored = useData(["ai-insights", "weekly_review"], () => listInsights<WeeklyReview>("weekly_review", 10));
  const [selected, setSelected] = React.useState<string | null>(null);
  const generate = useAction(async () => {
    const r = await buildWeeklyReview();
    return saveInsight("weekly_review", "local", `Semana ${r.period.from} → ${r.period.to}`, r);
  }, { success: "Weekly Business Review generado" });
  const current = (stored.data ?? []).find((s) => s.id === selected) ?? stored.data?.[0];
  const narrateIt = useAction(async () => {
    const s = await loadAiSettings();
    const text = await narrate(s, "Weekly Business Review", current!.content);
    await saveInsight("weekly_review", s.provider, current!.title, { ...current!.content, narrative: text });
  }, { success: "Resumen ejecutivo agregado" });
  const exportPdf = async () => {
    if (!current) return;
    const bytes = await weeklyReviewPdf(current.content);
    const path = await saveFile(`sovare-weekly-review-${current.content.period.to}.pdf`, bytes, "pdf");
    if (path) toast.show({ title: "PDF exportado", body: path, tone: "success" });
  };
  const r = current?.content;
  return (
    <div className="grid gap-4 xl:grid-cols-[240px_1fr]">
      <div className="space-y-2">
        <Button variant="primary" className="w-full" icon={<FileText className="size-4" />} loading={generate.pending} onClick={async () => { const id = await generate.run(); if (id) setSelected(id); }}>Generar reporte semanal</Button>
        {(stored.data ?? []).map((s) => (
          <button key={s.id} onClick={() => setSelected(s.id)} className={cx("block w-full rounded-lg px-3 py-2 text-left text-[12.5px]", current?.id === s.id ? "bg-surface shadow-[var(--shadow-sm)]" : "hover:bg-surface-2")}>
            <p className="font-medium">{s.title}</p>
            <p className="text-[11px] text-ink-3">{fmtDate(s.created_at, "d MMM HH:mm")}{s.content?.narrative ? " · con resumen IA" : ""}</p>
          </button>
        ))}
      </div>
      {!r ? (
        <Card><EmptyState icon={<FileText />} title="Todavía no generaste un reporte" body="El Weekly Business Review se calcula con tus datos registrados de los últimos 7 días vs los 7 anteriores." /></Card>
      ) : (
        <Card>
          <CardHeader title={`Weekly Business Review · ${fmtDate(r.period.from)} – ${fmtDate(r.period.to)}`} subtitle={r.demo ? "MODO DEMO — datos ficticios" : `Comparado con ${fmtDate(r.previous.from)} – ${fmtDate(r.previous.to)}`} actions={<><Button size="sm" icon={<Wand2 className="size-3.5" />} disabled={!available} loading={narrateIt.pending} onClick={() => void narrateIt.run()}>Resumen con IA</Button><Button size="sm" icon={<Download className="size-3.5" />} onClick={() => void exportPdf()}>Exportar PDF</Button></>} />
          <div className="space-y-5 px-4 pb-5 text-[13px]">
            {r.narrative && <div className="rounded-lg bg-accent-soft/60 p-3"><p className="mb-1 text-[11.5px] font-medium text-ink-3">Resumen ejecutivo (IA, basado solo en este reporte)</p><Markdown text={r.narrative} /></div>}
            <Section title="Resultados financieros">
              {!r.finance.length ? <p className="text-ink-3">Sin transacciones en el período.</p> : (
                <table className="tbl"><thead><tr><th>Moneda</th><th className="text-right">Ingresos netos</th><th className="text-right">Semana previa</th><th className="text-right">Gastos</th><th className="text-right">Beneficio</th><th className="text-right">Inversión</th></tr></thead>
                  <tbody>{r.finance.map((f) => <tr key={f.currency}><td>{f.currency}</td><td className="text-right tabular">{formatMoney(f.netRevenue, f.currency)}</td><td className="text-right tabular text-ink-3">{formatMoney(f.prevNetRevenue, f.currency)}</td><td className="text-right tabular">{formatMoney(f.expenses, f.currency)}</td><td className="text-right tabular">{formatMoney(f.profit, f.currency)}</td><td className="text-right tabular">{formatMoney(f.investment, f.currency)}</td></tr>)}</tbody>
                </table>
              )}
            </Section>
            <div className="grid gap-5 md:grid-cols-2">
              <Section title="Mejoras">{r.improvements.length ? <ul className="space-y-1">{r.improvements.map((x, i) => <li key={i}>• {x}</li>)}</ul> : <p className="text-ink-3">Sin mejoras medibles.</p>}</Section>
              <Section title="Problemas">{r.problems.length ? <ul className="space-y-1">{r.problems.map((x, i) => <li key={i}>• {x}</li>)}</ul> : <p className="text-ink-3">Sin problemas detectados.</p>}</Section>
              <Section title="Proyectos destacados">{r.topProjects.length ? <ul className="space-y-1">{r.topProjects.map((p, i) => <li key={i}>• {p.name}: {formatMoney(p.netRevenue, p.currency)} ingresos · {formatMoney(p.profit, p.currency)} beneficio</li>)}</ul> : <p className="text-ink-3">Sin ingresos por proyecto.</p>}</Section>
              <Section title="Campañas relevantes">{r.campaigns.length ? <ul className="space-y-1">{r.campaigns.map((c, i) => <li key={i}>• {c.name}: {c.spend != null && c.currency ? formatMoney(c.spend, c.currency) : "—"} · conv. {c.conversions ?? "sin datos"}</li>)}</ul> : <p className="text-ink-3">Sin gasto publicitario.</p>}</Section>
              <Section title="Tareas realizadas">{r.tasksDone.length ? <ul className="space-y-1">{r.tasksDone.slice(0, 12).map((t, i) => <li key={i}>• {t.title}{t.project ? ` (${t.project})` : ""}</li>)}</ul> : <p className="text-ink-3">Ninguna.</p>}</Section>
              <Section title="Desarrollo"><p>{r.development.commits} commits · {r.development.prsMerged} PRs · {r.development.releases} releases · {r.development.deploysOk} deploys OK · {r.development.deploysFailed} fallidos · {r.development.workflowsFailed} CI fallidos</p></Section>
            </div>
            <Section title="Prioridades para la próxima semana"><ol className="list-decimal space-y-1 pl-5">{r.priorities.map((p, i) => <li key={i}><b className="font-medium">{p.title}</b> <span className="text-ink-3">— {p.reason}</span></li>)}</ol></Section>
          </div>
        </Card>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

