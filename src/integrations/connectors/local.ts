import type { ConnectorDef } from "../types";
import { listRoots } from "@/platform/folders";
import { publicRequest, parseOrThrow } from "@/platform/http";
import { withRetry } from "../retry";
import { addRate, listRates } from "@/repos/finance";
import { listHealthChecks, listHealthResults, recordHealthResult } from "@/repos/dev";
import { db } from "@/db";
import type { HealthCheck } from "@/domain/types";
import { getPref } from "@/repos/core";

export const localFoldersConnector: ConnectorDef = {
  id: "local_folders",
  name: "Carpetas locales",
  category: "development",
  description: "Descubre proyectos en carpetas que vos autorizás (Git, manifests, Dockerfiles, configs de deploy).",
  availability: "available",
  auth: "folder",
  permissions: ["Lectura de las carpetas elegidas en el selector de macOS (nada más)"],
  setup: ["Projects → Descubrir → Agregar carpeta.", "Elegí una carpeta de proyectos concreta (no tu carpeta personal completa).", "Revisá los candidatos y confirmá cuáles registrar."],
  limitations: ["Nunca se modifican ni se ejecutan comandos en tus repositorios: solo se leen archivos de manifiesto y metadatos de Git."],
  incremental: false,
  configFields: [],
  isConfigured: async () => (await listRoots()).length > 0,
};

export const csvConnector: ConnectorDef = {
  id: "csv",
  name: "Importación CSV",
  category: "data",
  description: "Importá transacciones (bancos, Mercado Pago, Stripe, planillas) y métricas de anuncios.",
  availability: "available",
  auth: "file",
  permissions: ["Solo el archivo que elijas"],
  setup: ["Finance → Transacciones → Importar CSV.", "Mapeá columnas (se detectan automáticamente), revisá la vista previa e importá.", "Reimportar el mismo archivo no duplica registros. Cada importación se puede deshacer."],
  limitations: [],
  incremental: false,
  configFields: [],
  isConfigured: async () => (await db().select("SELECT 1 FROM financial_transactions WHERE source = 'csv' LIMIT 1")).length > 0,
};

export async function runHealthCheck(c: HealthCheck) {
  try {
    const r = await publicRequest({ method: c.method, url: c.url, timeoutMs: c.timeout_ms });
    const ok = r.status === c.expected_status;
    await recordHealthResult(c, { ok, status_code: r.status, latency_ms: r.latencyMs, error: ok ? null : `HTTP ${r.status} (esperado ${c.expected_status})` });
    return ok;
  } catch (e) {
    await recordHealthResult(c, { ok: false, status_code: null, latency_ms: null, error: (e as Error).message.slice(0, 200) });
    return false;
  }
}

/** Runs checks whose interval has elapsed. Only while the app is open (no background daemon). */
export async function runDueHealthChecks(force = false): Promise<{ ran: number; failed: number }> {
  const checks = (await listHealthChecks()).filter((c) => c.enabled);
  let ran = 0;
  let failed = 0;
  for (const c of checks) {
    const last = (await listHealthResults(c.id, 1))[0];
    const due = force || !last || Date.now() - Date.parse(last.checked_at) >= c.interval_minutes * 60_000;
    if (!due) continue;
    ran++;
    if (!(await runHealthCheck(c))) failed++;
  }
  return { ran, failed };
}

export const monitoringConnector: ConnectorDef = {
  id: "monitoring",
  name: "Health checks",
  category: "hosting",
  description: "Disponibilidad, código HTTP y latencia de tus endpoints de salud.",
  availability: "available",
  auth: "none",
  permissions: ["Peticiones GET/HEAD a las URLs que registres"],
  setup: ["Development → Monitoring → Nuevo health check.", "Usá un endpoint liviano (p. ej. /api/health) que devuelva 200."],
  limitations: [
    "Los chequeos corren SOLO mientras Sovare HQ está abierta (también minimizada o en la barra de menú).",
    "Para monitoreo 24/7 con la Mac apagada hace falta un servicio externo (UptimeRobot, Better Stack, cron en un servidor).",
  ],
  incremental: false,
  configFields: [],
  isConfigured: async () => (await listHealthChecks()).length > 0,
  sync: async () => {
    const r = await runDueHealthChecks(true);
    return { fetched: r.ran, upserted: r.ran, details: `${r.ran} chequeos · ${r.failed} fallidos` };
  },
};

export const fxConnector: ConnectorDef = {
  id: "fx_dolarapi",
  name: "Tipos de cambio (DolarAPI)",
  category: "finance",
  description: "Cotización USD/ARS pública (oficial, blue, MEP, tarjeta, mayorista) para conversiones explícitas.",
  availability: "available",
  auth: "none",
  permissions: ["GET público a dolarapi.com"],
  setup: ["Elegí la cotización (casa) a usar y sincronizá. Cada tipo de cambio guarda fuente y fecha.", "También podés cargar tipos de cambio manuales en Finance → Tipos de cambio."],
  docsUrl: "https://dolarapi.com/docs/",
  limitations: ["Servicio público de terceros, sin garantías. Las conversiones siempre muestran la fuente y fecha utilizadas."],
  incremental: false,
  syncEveryMinutes: 360,
  configFields: [
    {
      key: "casa",
      label: "Cotización",
      type: "select",
      options: [
        { value: "oficial", label: "Oficial" },
        { value: "blue", label: "Blue" },
        { value: "bolsa", label: "MEP (bolsa)" },
        { value: "contadoconliqui", label: "CCL" },
        { value: "tarjeta", label: "Tarjeta" },
        { value: "mayorista", label: "Mayorista" },
      ],
    },
  ],
  isConfigured: async () => (await listRates()).some((r) => r.source.startsWith("dolarapi")),
  test: async () => {
    const r = await withRetry(() => publicRequest({ url: "https://dolarapi.com/v1/dolares" }));
    const data = parseOrThrow<Array<{ casa: string }>>(r);
    return { ok: true, message: `OK · ${data.length} cotizaciones disponibles` };
  },
  sync: async (ctx) => {
    const casa = ctx.config.casa || "oficial";
    const r = await withRetry(() => publicRequest({ url: `https://dolarapi.com/v1/dolares/${encodeURIComponent(casa)}` }));
    const d = parseOrThrow<{ casa: string; compra: number; venta: number; fechaActualizacion: string }>(r);
    if (!(d.venta > 0)) throw new Error("Cotización inválida recibida");
    await addRate("USD", "ARS", d.venta, d.fechaActualizacion.slice(0, 10), `dolarapi.com · ${d.casa} (venta)`);
    return { fetched: 1, upserted: 1, details: `USD→ARS ${d.venta} (${d.casa}, ${d.fechaActualizacion.slice(0, 10)})` };
  },
};

export const aiConnector: ConnectorDef = {
  id: "ai",
  name: "Proveedor de IA",
  category: "ai",
  description: "OpenAI, Anthropic o un modelo local compatible (Ollama / LM Studio) para el asistente.",
  availability: "available",
  auth: "token",
  permissions: ["API key del proveedor elegido (no necesaria para modelos locales)"],
  setup: [
    "AI Insights funciona sin IA externa (motor local de reglas).",
    "Para el asistente conversacional: Settings → IA y privacidad → elegí proveedor y modelo.",
    "Pegá la API key (se guarda en el Llavero) y activá el análisis externo y las categorías a compartir.",
  ],
  limitations: ["Ningún dato se envía al proveedor sin que actives el análisis externo y las categorías correspondientes."],
  incremental: false,
  configFields: [],
  isConfigured: async () => {
    const s = await getPref<{ provider?: string }>("ai.settings", {});
    return !!s.provider && s.provider !== "none";
  },
};
