import type { ConnectorDef } from "../types";
import { secureJson } from "@/platform/http";
import { withRetry } from "../retry";
import { upsertCampaigns, upsertAdMetrics, type CampaignUpsert } from "@/repos/marketing";
import { upsertObservations } from "@/repos/metrics";
import { addDays, todayStr } from "@/lib/util";
import { toMinor } from "@/domain/money";

interface MetaAction {
  action_type: string;
  value: string;
}

export const metaAdsConnector: ConnectorDef = {
  id: "meta_ads",
  name: "Meta Ads",
  category: "marketing",
  description: "Campañas, presupuestos y métricas diarias de Facebook/Instagram Ads (solo lectura).",
  availability: "available",
  auth: "token",
  secretKey: "meta_ads",
  secretLabel: "Access token con permiso ads_read",
  permissions: ["ads_read"],
  setup: [
    "Meta for Developers → creá una app de tipo Business (o usá una existente).",
    "Business Settings → Usuarios del sistema → generá un token con el permiso ads_read y asigná la cuenta publicitaria.",
    "Copiá el ID de la cuenta publicitaria (act_XXXXXXXX) en la configuración.",
    "Opcional: indicá la acción de conversión a contar (p. ej. purchase, lead). Si la dejás vacía, las conversiones se muestran como ‘Sin datos’.",
  ],
  docsUrl: "https://developers.facebook.com/docs/marketing-api/insights",
  limitations: [
    "Modo lectura: nunca se pausan campañas, se cambian presupuestos ni se publican anuncios.",
    "Conversiones y ROAS solo se muestran si configurás la acción de conversión y Meta la reporta.",
    "El alcance (reach) no es aditivo entre días; se muestra el máximo diario.",
    "Los tokens de usuario expiran (60 días); los de usuario del sistema no.",
  ],
  incremental: true,
  syncEveryMinutes: 180,
  configFields: [
    { key: "ad_account_id", label: "ID de cuenta publicitaria", placeholder: "act_1234567890", required: true },
    { key: "conversion_action", label: "Acción de conversión (opcional)", placeholder: "purchase" },
    { key: "api_version", label: "Versión de Graph API", placeholder: "v23.0" },
    { key: "project_id", label: "Proyecto por defecto", type: "project" },
  ],
  test: async (ctx) => {
    const v = ctx.config.api_version || "v23.0";
    const { data } = await withRetry(() => secureJson<{ id: string; name: string }>("meta_ads", { url: `https://graph.facebook.com/${v}/me?fields=id,name` }));
    let msg = `Token válido (${data.name})`;
    if (ctx.config.ad_account_id) {
      const act = ctx.config.ad_account_id.startsWith("act_") ? ctx.config.ad_account_id : `act_${ctx.config.ad_account_id}`;
      const acc = await withRetry(() => secureJson<{ name: string; currency: string }>("meta_ads", { url: `https://graph.facebook.com/${v}/${act}?fields=name,currency` }));
      msg += ` · cuenta ${acc.data.name} (${acc.data.currency})`;
    }
    return { ok: true, message: msg, accountLabel: data.name };
  },
  sync: async (ctx) => {
    const v = ctx.config.api_version || "v23.0";
    if (!ctx.config.ad_account_id) throw new Error("Falta el ID de la cuenta publicitaria");
    const act = ctx.config.ad_account_id.startsWith("act_") ? ctx.config.ad_account_id : `act_${ctx.config.ad_account_id}`;
    const base = `https://graph.facebook.com/${v}`;
    const account = await withRetry(() => secureJson<{ currency: string; name: string }>("meta_ads", { url: `${base}/${act}?fields=currency,name` }));
    const currency = account.data.currency;
    const camps: CampaignUpsert[] = [];
    let next: string | null = `${base}/${act}/campaigns?fields=id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time&limit=100`;
    for (let i = 0; next && i < 10; i++) {
      const r: { data: { data: Array<{ id: string; name: string; objective?: string; status: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; start_time?: string; stop_time?: string }>; paging?: { next?: string } } } =
        await withRetry(() => secureJson("meta_ads", { url: next! }));
      for (const c of r.data.data)
        camps.push({
          platform: "meta_ads",
          account_id: act,
          external_id: c.id,
          level: "campaign",
          parent_external_id: null,
          project_id: ctx.projectFor(c.id) ?? (ctx.config.project_id || null),
          name: c.name,
          objective: c.objective ?? null,
          status: c.effective_status ?? c.status,
          daily_budget_minor: c.daily_budget ? Number(c.daily_budget) : null,
          lifetime_budget_minor: c.lifetime_budget ? Number(c.lifetime_budget) : null,
          currency,
          start_on: c.start_time?.slice(0, 10) ?? null,
          end_on: c.stop_time?.slice(0, 10) ?? null,
          source: "meta_ads",
        });
      next = r.data.paging?.next ?? null;
    }
    const idMap = await upsertCampaigns(camps);
    const since = ctx.cursor ? addDays(ctx.cursor, -3) : addDays(todayStr(), -30);
    const until = todayStr();
    const action = ctx.config.conversion_action?.trim() || null;
    const rows: Parameters<typeof upsertAdMetrics>[0] = [];
    let url: string | null = `${base}/${act}/insights?level=campaign&time_increment=1&limit=500&fields=campaign_id,impressions,reach,clicks,spend,actions,action_values&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
    for (let i = 0; url && i < 30; i++) {
      const r: { data: { data: Array<{ campaign_id: string; date_start: string; impressions?: string; reach?: string; clicks?: string; spend?: string; actions?: MetaAction[]; action_values?: MetaAction[] }>; paging?: { next?: string } } } =
        await withRetry(() => secureJson("meta_ads", { url: url! }));
      for (const d of r.data.data) {
        const cid = idMap[d.campaign_id];
        if (!cid) continue;
        const conv = action ? Number(d.actions?.find((a) => a.action_type === action)?.value ?? 0) : null;
        const val = action ? d.action_values?.find((a) => a.action_type === action)?.value : undefined;
        rows.push({
          campaign_id: cid,
          date: d.date_start,
          impressions: d.impressions != null ? Number(d.impressions) : null,
          reach: d.reach != null ? Number(d.reach) : null,
          clicks: d.clicks != null ? Number(d.clicks) : null,
          spend_minor: d.spend != null ? toMinor(Number(d.spend), currency) : null,
          currency,
          conversions: conv,
          conversion_value_minor: val != null ? toMinor(Number(val), currency) : null,
          conversion_label: action,
          source: "meta_ads",
        });
      }
      url = r.data.paging?.next ?? null;
    }
    const n = await upsertAdMetrics(rows);
    return { fetched: camps.length + rows.length, upserted: n + camps.length, cursor: until, accountLabel: account.data.name, details: `${camps.length} campañas · ${rows.length} filas diarias (${since} → ${until})` };
  },
};

export const googleAdsConnector: ConnectorDef = {
  id: "google_ads",
  name: "Google Ads",
  category: "marketing",
  description: "Campañas y métricas de Google Ads.",
  availability: "limited",
  auth: "oauth_token",
  permissions: ["OAuth scope adwords + developer token aprobado"],
  setup: [
    "La API de Google Ads exige un developer token aprobado por Google y un flujo OAuth con backend: no puede habilitarse de forma segura en una app local sin esa aprobación.",
    "Alternativa disponible hoy: Google Ads → Informes → descargá un CSV por día y campaña e importalo en Marketing → Importar CSV.",
  ],
  docsUrl: "https://developers.google.com/google-ads/api/docs/get-started/dev-token",
  limitations: ["Solo importación manual por CSV en esta versión."],
  incremental: false,
  configFields: [],
};

export const ga4Connector: ConnectorDef = {
  id: "ga4",
  name: "Google Analytics 4",
  category: "analytics",
  description: "Usuarios activos, usuarios nuevos, sesiones y eventos clave por día.",
  availability: "limited",
  auth: "oauth_token",
  secretKey: "ga4",
  secretLabel: "OAuth access token (scope analytics.readonly)",
  permissions: ["https://www.googleapis.com/auth/analytics.readonly"],
  setup: [
    "Abrí Google OAuth 2.0 Playground, seleccioná ‘Google Analytics Data API v1beta → analytics.readonly’ y autorizá.",
    "Intercambiá el código y copiá el Access token.",
    "Pegalo acá e indicá el Property ID (Admin → Property settings).",
  ],
  docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
  limitations: [
    "Los access tokens de Google expiran en ~1 hora: hay que renovarlos para volver a sincronizar. Un flujo OAuth completo con refresh token requiere registrar un cliente OAuth propio (pendiente).",
    "Los datos sincronizados quedan guardados y disponibles offline.",
  ],
  incremental: false,
  configFields: [
    { key: "property_id", label: "Property ID", placeholder: "123456789", required: true },
    { key: "project_id", label: "Proyecto", type: "project", required: true },
  ],
  test: async (ctx) => {
    if (!ctx.config.property_id) return { ok: false, message: "Falta el Property ID" };
    await withRetry(() =>
      secureJson("ga4", { method: "POST", url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(ctx.config.property_id)}:runReport`, body: JSON.stringify({ dateRanges: [{ startDate: "yesterday", endDate: "today" }], metrics: [{ name: "activeUsers" }] }) }),
    );
    return { ok: true, message: `Acceso a la propiedad ${ctx.config.property_id} verificado` };
  },
  sync: async (ctx) => {
    if (!ctx.config.property_id || !ctx.config.project_id) throw new Error("Configurá Property ID y proyecto");
    const metrics = ["activeUsers", "newUsers", "sessions", "keyEvents"];
    const { data } = await withRetry(() =>
      secureJson<{ rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }> }>("ga4", {
        method: "POST",
        url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(ctx.config.property_id)}:runReport`,
        body: JSON.stringify({ dateRanges: [{ startDate: "30daysAgo", endDate: "today" }], dimensions: [{ name: "date" }], metrics: metrics.map((name) => ({ name })) }),
      }),
    );
    const keyMap: Record<string, string> = { activeUsers: "active_users", newUsers: "new_users", sessions: "sessions", keyEvents: "key_events" };
    const obs = (data.rows ?? []).flatMap((r) => {
      const d = r.dimensionValues[0].value;
      const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      return metrics.map((m, i) => ({ project_id: ctx.config.project_id, metric_key: keyMap[m], value: Number(r.metricValues[i].value), unit: "count", period_start: day, period_end: day, source: "ga4", source_ref: ctx.config.property_id }));
    });
    const n = await upsertObservations(obs);
    return { fetched: data.rows?.length ?? 0, upserted: n, details: `${data.rows?.length ?? 0} días` };
  },
};
