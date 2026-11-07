/**
 * Typed wrappers over the Rust commands exposed by src-tauri. Only imported lazily, so the
 * browser build never touches Tauri APIs.
 */
import { invoke } from "@tauri-apps/api/core";

export interface NativeError {
  code: string;
  message: string;
}

export function toError(e: unknown): Error & { code?: string } {
  if (e && typeof e === "object" && "message" in e) {
    const err = new Error(String((e as NativeError).message)) as Error & { code?: string };
    err.code = (e as NativeError).code;
    return err;
  }
  return new Error(String(e));
}

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toError(e);
  }
}
