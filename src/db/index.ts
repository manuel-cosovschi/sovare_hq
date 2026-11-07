import type { Db } from "./types";
import { migrate } from "./migrate";
import { isNative } from "@/platform/runtime";

export type Profile = "main" | "demo";

interface Active {
  db: Db;
  profile: Profile;
  location: string;
  exportBytes?: () => Uint8Array;
  importBytes?: (b: Uint8Array) => Promise<void>;
}

let active: Active | null = null;
const listeners = new Set<() => void>();

export function db(): Db {
  if (!active) throw new Error("Database not initialised");
  return active.db;
}

export const activeProfile = (): Profile => active?.profile ?? "main";
export const activeLocation = () => active?.location ?? "";
export const browserBackup = () => active?.exportBytes;
export const browserRestore = () => active?.importBytes;

/** Used by tests (in-memory sql.js) */
export async function installDb(d: Db, profile: Profile = "main"): Promise<void> {
  await migrate(d);
  active = { db: d, profile, location: "memory" };
}

export function storedProfile(): Profile {
  try {
    return localStorage.getItem("sovare.profile") === "demo" ? "demo" : "main";
  } catch {
    return "main";
  }
}

export async function openDatabase(profile: Profile): Promise<Active> {
  if (isNative()) {
    const { openNativeDb } = await import("./nativeDb");
    const d = await openNativeDb(profile);
    await migrate(d);
    active = { db: d, profile, location: d.path };
  } else {
    const { openBrowserDb, flushAll } = await import("./browserDb");
    await flushAll();
    const d = await openBrowserDb(profile);
    await migrate(d);
    active = { db: d, profile, location: d.path, exportBytes: d.exportBytes, importBytes: d.importBytes };
  }
  try {
    localStorage.setItem("sovare.profile", profile);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
  return active;
}

export function onProfileChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
