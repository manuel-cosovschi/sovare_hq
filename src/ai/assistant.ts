import { TOOLS, executeTool, toolJsonSchema } from "./tools";
import { providerFor, type ChatTurn, type ToolSpec } from "./providers";
import { assistantAvailability, type AiSettings } from "./settings";
import { activeProfile } from "@/db";
import { todayStr } from "@/lib/util";

export const SYSTEM_PROMPT = (demo: boolean) => `Sos el analista de negocio de Sovare HQ, el centro de control personal de un desarrollador que gestiona varios emprendimientos de software.
Fecha de hoy: ${todayStr()}.${demo ? "\nATENCIÓN: la app está en MODO DEMO; los datos son ficticios y debés aclararlo." : ""}

Reglas:
- Obtené los datos SIEMPRE con las herramientas disponibles. No inventes cifras, métricas, conversiones ni atribuciones. No asumas nada por el nombre de un proyecto.
- Nunca sumes importes de monedas distintas. Distinguí ingresos, beneficio operativo, inversión y flujo de caja.
- Si una herramienta informa que una categoría está desactivada por privacidad o no hay datos suficientes, decilo y sugerí qué conexión o registro mejoraría el análisis.
- Clasificá cada afirmación como **Hecho** (dato registrado), **Estimación** (cálculo sobre datos) o **Hipótesis** (interpretación).
- Para cada recomendación usá este formato:
  ### <Recomendación>
  - **Razón:** …
  - **Evidencia:** … (datos y herramienta usada)
  - **Impacto estimado:** … (solo si es justificable; si no, "no estimable")
  - **Confianza:** alta | media | baja
  - **Acción sugerida:** …
- Respondé en español rioplatense, conciso y concreto. Usá Markdown simple.`;

export interface AssistantTrace {
  tool: string;
  args: unknown;
  ok: boolean;
}

export async function askAssistant(settings: AiSettings, history: Array<{ role: "user" | "assistant"; content: string }>, question: string): Promise<{ answer: string; trace: AssistantTrace[] }> {
  const avail = assistantAvailability(settings);
  if (!avail.ok) throw new Error(avail.reason);
  const allowedTools = TOOLS.filter((t) => settings.categories[t.category]);
  const tools: ToolSpec[] = allowedTools.map((t) => ({ name: t.name, description: `${t.description} (categoría: ${t.category})`, parameters: toolJsonSchema(t) }));
  const provider = providerFor(settings);
  const turns: ChatTurn[] = [...history.slice(-10).map((m) => ({ role: m.role, content: m.content }) as ChatTurn), { role: "user", content: question }];
  const trace: AssistantTrace[] = [];
  const system = SYSTEM_PROMPT(activeProfile() === "demo");
  for (let round = 0; round < 6; round++) {
    const r = await provider.complete(system, turns, tools);
    if (!r.toolCalls.length) return { answer: r.text || "(sin respuesta)", trace };
    turns.push({ role: "assistant", content: r.text, toolCalls: r.toolCalls });
    for (const call of r.toolCalls) {
      const out = await executeTool(call.name, call.args, settings.categories);
      trace.push({ tool: call.name, args: call.args, ok: out.ok });
      turns.push({ role: "tool", callId: call.id, name: call.name, content: JSON.stringify(out.result).slice(0, 20_000) });
    }
  }
  return { answer: "Alcancé el límite de pasos de análisis. Probá una pregunta más específica.", trace };
}

/** Optional executive narrative for a computed report (only the report JSON is sent). */
export async function narrate(settings: AiSettings, title: string, report: unknown): Promise<string> {
  const avail = assistantAvailability(settings);
  if (!avail.ok) throw new Error(avail.reason);
  const provider = providerFor(settings);
  const r = await provider.complete(
    SYSTEM_PROMPT(activeProfile() === "demo"),
    [{ role: "user", content: `Redactá un resumen ejecutivo breve (máx. 200 palabras) de este ${title}. Usá solo estos datos:\n\n${JSON.stringify(report).slice(0, 30_000)}` }],
    [],
  );
  return r.text;
}
