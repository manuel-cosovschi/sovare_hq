import type { TxKind } from "./types";

export interface CategoryDef {
  id: string;
  label: string;
  kinds: TxKind[];
  nature?: "fixed" | "variable";
}

/** Financial categories. `nature` drives contribution-margin calculations for expenses. */
export const CATEGORIES: CategoryDef[] = [
  { id: "sales", label: "Ventas", kinds: ["income", "refund"] },
  { id: "subscriptions", label: "Suscripciones", kinds: ["income", "refund"] },
  { id: "services", label: "Servicios / Consultoría", kinds: ["income", "refund"] },
  { id: "other_income", label: "Otros ingresos", kinds: ["income"] },
  { id: "payment_processing", label: "Procesamiento de pagos", kinds: ["fee", "expense"], nature: "variable" },
  { id: "hosting", label: "Hosting / Infraestructura", kinds: ["expense", "investment"], nature: "fixed" },
  { id: "ai", label: "IA / APIs", kinds: ["expense"], nature: "variable" },
  { id: "advertising", label: "Publicidad", kinds: ["expense", "investment"], nature: "variable" },
  { id: "tools", label: "Herramientas / SaaS", kinds: ["expense"], nature: "fixed" },
  { id: "domains", label: "Dominios", kinds: ["expense", "investment"], nature: "fixed" },
  { id: "design", label: "Diseño", kinds: ["expense", "investment"], nature: "fixed" },
  { id: "contractors", label: "Freelancers / Contratistas", kinds: ["expense", "investment"], nature: "variable" },
  { id: "cogs", label: "Costo de mercadería", kinds: ["expense"], nature: "variable" },
  { id: "shipping", label: "Envíos / Logística", kinds: ["expense"], nature: "variable" },
  { id: "taxes", label: "Impuestos", kinds: ["expense"], nature: "fixed" },
  { id: "legal", label: "Legal / Contable", kinds: ["expense"], nature: "fixed" },
  { id: "development", label: "Desarrollo", kinds: ["investment", "expense"], nature: "fixed" },
  { id: "equipment", label: "Equipamiento", kinds: ["investment", "expense"], nature: "fixed" },
  { id: "other", label: "Otros", kinds: ["income", "expense", "refund", "fee", "investment"], nature: "fixed" },
];

export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
export const categoriesFor = (kind: TxKind) => CATEGORIES.filter((c) => c.kinds.includes(kind));
export const isVariable = (id: string) => CATEGORIES.find((c) => c.id === id)?.nature === "variable";
