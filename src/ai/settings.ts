import { getPref, setPref } from "@/repos/core";

export const DATA_CATEGORIES = {
  projects: "Proyectos (nombres, estados, stack)",
  tasks: "Tareas y roadmap",
  development: "Actividad de desarrollo (commits, PRs, deploys)",
  alerts: "Alertas",
  finance: "Finanzas (importes, transacciones)",
  marketing: "Campañas publicitarias",
  analytics: "Métricas de producto",
} as const;
export type DataCategory = keyof typeof DATA_CATEGORIES;

export type AiProvider = "none" | "openai" | "anthropic" | "ollama";

export interface AiSettings {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  externalEnabled: boolean;
  categories: Record<DataCategory, boolean>;
}

export const DEFAULT_AI: AiSettings = {
  provider: "none",
  model: "",
  baseUrl: "http://localhost:11434",
  externalEnabled: false,
  categories: { projects: true, tasks: true, development: true, alerts: true, finance: false, marketing: false, analytics: false },
};

export const MODEL_PLACEHOLDER: Record<AiProvider, string> = {
  none: "",
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-5-5",
  ollama: "llama3.1",
};

export async function loadAiSettings(): Promise<AiSettings> {
  const s = await getPref<Partial<AiSettings>>("ai.settings", {});
  return { ...DEFAULT_AI, ...s, categories: { ...DEFAULT_AI.categories, ...(s.categories ?? {}) } };
}

export async function saveAiSettings(s: AiSettings) {
  await setPref("ai.settings", s);
}

/** True when data leaves the machine (cloud provider or a non-local OpenAI-compatible server). */
export function isExternal(s: AiSettings): boolean {
  if (s.provider === "ollama") {
    try {
      return !["localhost", "127.0.0.1", "[::1]"].includes(new URL(s.baseUrl).hostname);
    } catch {
      return true;
    }
  }
  return s.provider === "openai" || s.provider === "anthropic";
}

export function assistantAvailability(s: AiSettings): { ok: boolean; reason?: string } {
  if (s.provider === "none") return { ok: false, reason: "No hay proveedor de IA configurado. El motor local sigue funcionando." };
  if (isExternal(s) && !s.externalEnabled) return { ok: false, reason: "El análisis externo está desactivado en Privacidad." };
  return { ok: true };
}
