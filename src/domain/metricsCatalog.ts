/** Catalog of business metrics. Values come from metric_observations (synced or manual). */
export type MetricGroup = "saas" | "ecommerce" | "mobile" | "web";

export interface MetricDef {
  key: string;
  label: string;
  unit: "count" | "money" | "percent" | "ratio" | "seconds";
  group: MetricGroup;
  aggregation: "last" | "sum" | "avg";
  description: string;
  sources: string[]; // connectors able to provide it
}

export const METRICS: MetricDef[] = [
  { key: "registered_users", label: "Usuarios registrados", unit: "count", group: "saas", aggregation: "last", description: "Total de cuentas creadas.", sources: ["manual"] },
  { key: "active_users", label: "Usuarios activos", unit: "count", group: "saas", aggregation: "last", description: "Usuarios activos en el período.", sources: ["ga4", "manual"] },
  { key: "new_customers", label: "Nuevos clientes", unit: "count", group: "saas", aggregation: "sum", description: "Clientes que pagaron por primera vez.", sources: ["manual"] },
  { key: "active_subscriptions", label: "Suscriptores activos", unit: "count", group: "saas", aggregation: "last", description: "Suscripciones activas.", sources: ["stripe", "manual"] },
  { key: "mrr", label: "MRR", unit: "money", group: "saas", aggregation: "last", description: "Ingreso recurrente mensual normalizado.", sources: ["stripe", "manual"] },
  { key: "cancellations", label: "Cancelaciones", unit: "count", group: "saas", aggregation: "sum", description: "Suscripciones canceladas en el período.", sources: ["manual"] },
  { key: "churn_rate", label: "Churn", unit: "percent", group: "saas", aggregation: "last", description: "Cancelaciones / suscriptores al inicio del período.", sources: ["manual"] },
  { key: "retention_d30", label: "Retención 30 días", unit: "percent", group: "saas", aggregation: "last", description: "Porcentaje de usuarios que vuelven a los 30 días.", sources: ["manual"] },
  { key: "conversion_rate", label: "Conversión", unit: "percent", group: "saas", aggregation: "last", description: "Visitantes o trials que convierten a pago.", sources: ["manual"] },
  { key: "orders", label: "Pedidos", unit: "count", group: "ecommerce", aggregation: "sum", description: "Pedidos realizados.", sources: ["manual"] },
  { key: "units_sold", label: "Productos vendidos", unit: "count", group: "ecommerce", aggregation: "sum", description: "Unidades vendidas.", sources: ["manual"] },
  { key: "ecommerce_conversion", label: "Tasa de conversión", unit: "percent", group: "ecommerce", aggregation: "last", description: "Sesiones que terminan en compra.", sources: ["ga4", "manual"] },
  { key: "returning_customers", label: "Clientes recurrentes", unit: "count", group: "ecommerce", aggregation: "sum", description: "Clientes con más de una compra.", sources: ["manual"] },
  { key: "inventory_units", label: "Inventario", unit: "count", group: "ecommerce", aggregation: "last", description: "Unidades en stock.", sources: ["manual"] },
  { key: "installs", label: "Instalaciones", unit: "count", group: "mobile", aggregation: "sum", description: "Nuevas instalaciones.", sources: ["manual"] },
  { key: "mobile_active_users", label: "Usuarios activos (app)", unit: "count", group: "mobile", aggregation: "last", description: "Usuarios activos de la app.", sources: ["manual"] },
  { key: "sessions", label: "Sesiones", unit: "count", group: "web", aggregation: "sum", description: "Sesiones registradas.", sources: ["ga4", "manual"] },
  { key: "new_users", label: "Usuarios nuevos", unit: "count", group: "web", aggregation: "sum", description: "Usuarios nuevos.", sources: ["ga4", "manual"] },
  { key: "key_events", label: "Eventos clave (conversiones)", unit: "count", group: "web", aggregation: "sum", description: "Eventos marcados como clave en GA4.", sources: ["ga4", "manual"] },
  { key: "crash_rate", label: "Crash rate", unit: "percent", group: "mobile", aggregation: "last", description: "Sesiones con crash.", sources: ["manual"] },
  { key: "app_subscriptions", label: "Suscripciones (app)", unit: "count", group: "mobile", aggregation: "last", description: "Suscripciones activas in-app.", sources: ["manual"] },
];

export const GROUP_LABEL: Record<MetricGroup, string> = { saas: "SaaS", ecommerce: "E-commerce", mobile: "App móvil", web: "Tráfico web" };

export const metricDef = (key: string) => METRICS.find((m) => m.key === key);

export function groupsForType(type: string): MetricGroup[] {
  switch (type) {
    case "ecommerce":
    case "marketplace":
      return ["ecommerce", "web"];
    case "mobile":
      return ["mobile", "saas"];
    case "saas":
    case "web":
      return ["saas", "web"];
    default:
      return ["saas", "web"];
  }
}
