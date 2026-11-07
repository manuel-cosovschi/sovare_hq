import type { WeeklyReview } from "./weekly";
import { formatMoney } from "@/domain/money";

/** Renders the Weekly Business Review as a clean, text-first PDF. */
export async function weeklyReviewPdf(r: WeeklyReview): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  let y = M;
  const ensure = (h: number) => {
    if (y + h > doc.internal.pageSize.getHeight() - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (s: string, size = 10, color: [number, number, number] = [40, 44, 52], bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(s, W - M * 2) as string[];
    ensure(lines.length * size * 1.35);
    doc.text(lines, M, y);
    y += lines.length * size * 1.35;
  };
  const section = (t: string) => {
    y += 12;
    ensure(30);
    doc.setDrawColor(220, 214, 200);
    doc.line(M, y, W - M, y);
    y += 18;
    text(t, 12, [29, 46, 71], true);
    y += 2;
  };
  try {
    const blob = await (await fetch("/icons/icon-192.png")).blob();
    const dataUrl = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(blob);
    });
    doc.addImage(dataUrl, "PNG", M - 4, y - 8, 30, 30);
  } catch {
    /* logo is decorative */
  }
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(29, 46, 71);
  doc.text("Sovare HQ · Weekly Business Review", M + 32, y + 12);
  y += 34;
  text(`Período ${r.period.from} → ${r.period.to} (comparado con ${r.previous.from} → ${r.previous.to}). Generado ${r.generatedAt.slice(0, 16).replace("T", " ")}.`, 9, [110, 110, 110]);
  if (r.demo) text("MODO DEMO — datos de demostración, no reales.", 10, [180, 60, 40], true);
  if (r.narrative) {
    section("Resumen ejecutivo (redactado con IA a partir de los datos del reporte)");
    text(r.narrative.replace(/[#*]/g, ""), 10);
  }
  section("Resultados financieros");
  if (!r.finance.length) text("Sin transacciones registradas en el período.");
  for (const f of r.finance)
    text(`${f.currency}: ingresos netos ${formatMoney(f.netRevenue, f.currency)} (antes ${formatMoney(f.prevNetRevenue, f.currency)}) · gastos ${formatMoney(f.expenses, f.currency)} · beneficio operativo ${formatMoney(f.profit, f.currency)} · inversión ${formatMoney(f.investment, f.currency)}`);
  section("Proyectos destacados");
  if (!r.topProjects.length) text("Ningún proyecto registró ingresos en el período.");
  for (const p of r.topProjects) text(`• ${p.name}: ingresos ${formatMoney(p.netRevenue, p.currency)}, beneficio ${formatMoney(p.profit, p.currency)}`);
  section("Campañas relevantes");
  if (!r.campaigns.length) text("Sin gasto publicitario registrado.");
  for (const c of r.campaigns) text(`• ${c.name}: gasto ${c.spend != null && c.currency ? formatMoney(c.spend, c.currency) : "sin datos"} · conversiones ${c.conversions ?? "sin datos"} · CTR ${c.ctr != null ? c.ctr.toFixed(2) + "%" : "sin datos"}`);
  section("Desarrollo");
  const d = r.development;
  text(`${d.commits} commits · ${d.prsMerged} PRs fusionados · ${d.releases} releases · ${d.deploysOk} deploys OK · ${d.deploysFailed} deploys fallidos · ${d.workflowsFailed} workflows fallidos`);
  section("Tareas realizadas");
  if (!r.tasksDone.length) text("No se completaron tareas.");
  for (const t of r.tasksDone.slice(0, 25)) text(`• ${t.title}${t.project ? ` (${t.project})` : ""}`);
  section("Mejoras");
  if (!r.improvements.length) text("Sin mejoras medibles respecto de la semana anterior.");
  for (const i of r.improvements) text(`• ${i}`);
  section("Problemas");
  if (!r.problems.length) text("Sin problemas detectados.");
  for (const i of r.problems) text(`• ${i}`);
  section("Prioridades para la próxima semana");
  for (const p of r.priorities) text(`• ${p.title} — ${p.reason}`);
  return new Uint8Array(doc.output("arraybuffer"));
}
