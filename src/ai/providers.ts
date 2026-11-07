/** LLM provider abstraction with tool calling. Tokens never pass through here (injected natively). */
import { secureRequest, publicRequest, parseOrThrow } from "@/platform/http";
import type { AiSettings } from "./settings";
import { MODEL_PLACEHOLDER } from "./settings";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type ChatTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string };

export interface LlmResult {
  text: string;
  toolCalls: ToolCall[];
}

export interface LlmProvider {
  complete(system: string, turns: ChatTurn[], tools: ToolSpec[]): Promise<LlmResult>;
}

const safeParse = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

// OpenAI Chat Completions (also used for local OpenAI-compatible servers such as Ollama / LM Studio)
function openAiMessages(system: string, turns: ChatTurn[]) {
  return [
    { role: "system", content: system },
    ...turns.map((t) => {
      if (t.role === "tool") return { role: "tool", tool_call_id: t.callId, content: t.content };
      if (t.role === "assistant")
        return {
          role: "assistant",
          content: t.content || null,
          ...(t.toolCalls?.length ? { tool_calls: t.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {}),
        };
      return { role: "user", content: t.content };
    }),
  ];
}

type OpenAiResp = { choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };

function parseOpenAi(r: OpenAiResp): LlmResult {
  const m = r.choices?.[0]?.message;
  return { text: m?.content ?? "", toolCalls: (m?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: safeParse(c.function.arguments) })) };
}

const openAiTools = (tools: ToolSpec[]) => tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

export function providerFor(s: AiSettings): LlmProvider {
  const model = s.model.trim() || MODEL_PLACEHOLDER[s.provider];
  switch (s.provider) {
    case "openai":
      return {
        async complete(system, turns, tools) {
          const res = await secureRequest("openai", {
            method: "POST",
            url: "https://api.openai.com/v1/chat/completions",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: openAiMessages(system, turns), tools: openAiTools(tools), tool_choice: "auto" }),
            timeoutMs: 90_000,
          });
          return parseOpenAi(parseOrThrow<OpenAiResp>(res));
        },
      };
    case "ollama":
      return {
        async complete(system, turns, tools) {
          const base = s.baseUrl.replace(/\/+$/, "");
          const res = await publicRequest({
            method: "POST",
            url: `${base}/v1/chat/completions`,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: openAiMessages(system, turns), tools: openAiTools(tools), stream: false }),
            timeoutMs: 120_000,
          });
          return parseOpenAi(parseOrThrow<OpenAiResp>(res));
        },
      };
    case "anthropic":
      return {
        async complete(system, turns, tools) {
          const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];
          for (const t of turns) {
            if (t.role === "user") messages.push({ role: "user", content: t.content });
            else if (t.role === "assistant")
              messages.push({
                role: "assistant",
                content: [...(t.content ? [{ type: "text", text: t.content }] : []), ...(t.toolCalls ?? []).map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} }))],
              });
            else {
              const block = { type: "tool_result", tool_use_id: t.callId, content: t.content };
              const last = messages[messages.length - 1];
              if (last?.role === "user" && Array.isArray(last.content)) (last.content as unknown[]).push(block);
              else messages.push({ role: "user", content: [block] });
            }
          }
          const res = await secureRequest("anthropic", {
            method: "POST",
            url: "https://api.anthropic.com/v1/messages",
            headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model, max_tokens: 2048, system, messages, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }),
            timeoutMs: 120_000,
          });
          const r = parseOrThrow<{ content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> }>(res);
          return {
            text: r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
            toolCalls: r.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, name: b.name!, args: b.input })),
          };
        },
      };
    default:
      throw new Error("No hay proveedor de IA configurado");
  }
}

export async function testProvider(s: AiSettings): Promise<string> {
  if (s.provider === "openai") {
    parseOrThrow(await secureRequest("openai", { url: "https://api.openai.com/v1/models" }));
    return "Clave de OpenAI válida";
  }
  if (s.provider === "anthropic") {
    parseOrThrow(await secureRequest("anthropic", { url: "https://api.anthropic.com/v1/models", headers: { "anthropic-version": "2023-06-01" } }));
    return "Clave de Anthropic válida";
  }
  if (s.provider === "ollama") {
    parseOrThrow(await publicRequest({ url: `${s.baseUrl.replace(/\/+$/, "")}/v1/models` }));
    return "Servidor local accesible";
  }
  throw new Error("Elegí un proveedor");
}
