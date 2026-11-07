import { db } from "@/db";
import { nowIso, parseJson, uid } from "@/lib/util";

export interface StoredInsight<T = unknown> {
  id: string;
  kind: string;
  provider: string;
  title: string | null;
  content: T;
  created_at: string;
}

export async function saveInsight(kind: string, provider: string, title: string | null, content: unknown) {
  const id = uid();
  await db().execute("INSERT INTO ai_insights (id, kind, provider, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, kind, provider, title, JSON.stringify(content), nowIso()]);
  await db().execute("DELETE FROM ai_insights WHERE kind = ? AND id NOT IN (SELECT id FROM ai_insights WHERE kind = ? ORDER BY created_at DESC LIMIT 30)", [kind, kind]);
  return id;
}

export async function listInsights<T>(kind: string, limit = 10): Promise<StoredInsight<T>[]> {
  const rows = await db().select<{ id: string; kind: string; provider: string; title: string | null; content: string; created_at: string }>(
    "SELECT * FROM ai_insights WHERE kind = ? ORDER BY created_at DESC LIMIT ?",
    [kind, limit],
  );
  return rows.map((r) => ({ ...r, content: parseJson<T>(r.content, null as T) }));
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  meta: { tools?: Array<{ name: string; args: unknown }>; provider?: string; error?: boolean } | null;
  created_at: string;
}

export async function addMessage(conversationId: string, role: "user" | "assistant", content: string, meta?: ChatMessage["meta"]) {
  await db().execute("INSERT INTO ai_messages (id, conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)", [uid(), conversationId, role, content, meta ? JSON.stringify(meta) : null, nowIso()]);
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db().select<{ id: string; conversation_id: string; role: "user" | "assistant"; content: string; meta: string | null; created_at: string }>(
    "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at",
    [conversationId],
  );
  return rows.map((r) => ({ ...r, meta: parseJson(r.meta, null) }));
}

export async function clearConversation(conversationId: string) {
  await db().execute("DELETE FROM ai_messages WHERE conversation_id = ?", [conversationId]);
}
