import { isNative } from "./runtime";

export async function notificationPermission(): Promise<"granted" | "denied" | "default"> {
  if (isNative()) {
    const n = await import("@tauri-apps/plugin-notification");
    return (await n.isPermissionGranted()) ? "granted" : "default";
  }
  return typeof Notification === "undefined" ? "denied" : Notification.permission;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (isNative()) {
    const n = await import("@tauri-apps/plugin-notification");
    return (await n.requestPermission()) === "granted";
  }
  if (typeof Notification === "undefined") return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function notify(title: string, body: string) {
  try {
    if (isNative()) {
      const n = await import("@tauri-apps/plugin-notification");
      if (await n.isPermissionGranted()) n.sendNotification({ title, body });
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body });
  } catch (e) {
    console.warn("notification failed", e);
  }
}

export async function updateTray(lines: string[]) {
  if (!isNative()) return;
  const { call } = await import("./native");
  await call("tray_update", { summary: lines }).catch(() => undefined);
}

export async function onTrayAction(cb: (action: string) => void): Promise<() => void> {
  if (!isNative()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("tray-action", (e) => cb(e.payload));
}

export async function appInfo(): Promise<{ version: string; data_dir: string; platform: string }> {
  if (isNative()) {
    const { call } = await import("./native");
    return call("app_info");
  }
  return { version: __APP_VERSION__, data_dir: "IndexedDB (navegador)", platform: navigator.platform };
}

export async function nativeBackup(name: string): Promise<{ path: string; integrity: string; bytes: number } | null> {
  const { call } = await import("./native");
  return call("db_backup", { suggestedName: name });
}

export async function nativeRestore(): Promise<string | null> {
  const { call } = await import("./native");
  return call("db_restore");
}
