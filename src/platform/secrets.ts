/**
 * Credential storage — WRITE-ONLY from the UI.
 *  - Native: macOS Keychain via Rust (`secret_set`/`secret_status`/`secret_delete`). The webview can
 *    never read a token back; Rust injects it into allow-listed requests.
 *  - Browser fallback: AES-GCM encrypted in IndexedDB with a NON-extractable key. Weaker than the
 *    Keychain (documented in docs/SECURITY.md) but never plain text, never in SQLite.
 */
import { isNative } from "./runtime";
import { idbDelete, idbGet, idbSet } from "./idb";

export const SECRET_HOSTS = {
  github: ["api.github.com"],
  vercel: ["api.vercel.com"],
  netlify: ["api.netlify.com"],
  render: ["api.render.com"],
  stripe: ["api.stripe.com"],
  mercadopago: ["api.mercadopago.com"],
  meta_ads: ["graph.facebook.com"],
  ga4: ["analyticsdata.googleapis.com", "analyticsadmin.googleapis.com"],
  openai: ["api.openai.com"],
  anthropic: ["api.anthropic.com"],
} as const;
export type SecretKey = keyof typeof SECRET_HOSTS;
export const isSecretKey = (k: string): k is SecretKey => k in SECRET_HOSTS;

async function browserKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>("secret-master-key");
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbSet("secret-master-key", key);
  return key;
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const v = value.trim();
  if (!v) throw new Error("La credencial está vacía");
  if (isNative()) {
    const { call } = await import("./native");
    return call("secret_set", { key, value: v });
  }
  const k = await browserKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(v));
  await idbSet(`secret:${key}`, { iv, data });
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  if (isNative()) {
    const { call } = await import("./native");
    return call("secret_delete", { key });
  }
  await idbDelete(`secret:${key}`);
}

export async function secretStatus(keys: SecretKey[]): Promise<Record<string, boolean>> {
  if (isNative()) {
    const { call } = await import("./native");
    return call("secret_status", { keys });
  }
  const out: Record<string, boolean> = {};
  for (const k of keys) out[k] = !!(await idbGet(`secret:${k}`));
  return out;
}

/** Browser fallback only: decrypts a secret for an outgoing request. Never logged or persisted. */
export async function readBrowserSecret(key: SecretKey): Promise<string | null> {
  const rec = await idbGet<{ iv: Uint8Array; data: ArrayBuffer }>(`secret:${key}`);
  if (!rec) return null;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv as BufferSource }, await browserKey(), rec.data);
  return new TextDecoder().decode(plain);
}
