import { isNative } from "./runtime";
import { idbGet, idbSet } from "./idb";

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Saves an export through the native save dialog (or a browser download). */
export async function saveFile(name: string, content: string | Uint8Array, ext: "csv" | "pdf" | "json" | "txt" | "md"): Promise<string | null> {
  if (isNative()) {
    const { call } = await import("./native");
    const isBin = typeof content !== "string";
    return call<string | null>("save_file", { suggestedName: name, content: isBin ? bytesToBase64(content) : content, base64: isBin, extension: ext });
  }
  const mime = { csv: "text/csv", pdf: "application/pdf", json: "application/json", txt: "text/plain", md: "text/markdown" }[ext];
  const blob = new Blob([content as BlobPart], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return name;
}

export async function pickTextFile(extensions: string[]): Promise<{ name: string; content: string } | null> {
  if (isNative()) {
    const { call } = await import("./native");
    return call("pick_text_file", { extensions });
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((e) => "." + e).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      if (f.size > 15 * 1024 * 1024) return resolve(null);
      resolve({ name: f.name, content: await f.text() });
    };
    input.click();
  });
}

export interface AttachmentRef {
  name: string;
  original_name: string;
}

export async function attachFile(): Promise<AttachmentRef | null> {
  if (isNative()) {
    const { call } = await import("./native");
    return call("attach_file");
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.png,.jpg,.jpeg,.heic,.txt,.csv";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f || f.size > 25 * 1024 * 1024) return resolve(null);
      const name = `${crypto.randomUUID()}.${f.name.split(".").pop()?.toLowerCase() ?? "bin"}`;
      await idbSet(`att:${name}`, f);
      resolve({ name, original_name: f.name });
    };
    input.click();
  });
}

export async function openAttachment(name: string) {
  if (isNative()) {
    const { call } = await import("./native");
    return call("open_attachment", { name });
  }
  const blob = await idbGet<Blob>(`att:${name}`);
  if (blob) window.open(URL.createObjectURL(blob), "_blank", "noopener");
}

export async function openUrl(url: string) {
  if (!/^(https?:|mailto:)/.test(url)) throw new Error("Solo se pueden abrir enlaces http(s)");
  if (isNative()) {
    const { call } = await import("./native");
    return call("open_url", { url });
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function revealPath(path: string) {
  if (!isNative()) throw new Error("Disponible en la app de macOS");
  const { call } = await import("./native");
  return call("reveal_path", { path });
}

export async function openInEditor(path: string) {
  if (!isNative()) throw new Error("Disponible en la app de macOS");
  const { call } = await import("./native");
  return call("open_in_editor", { path });
}
