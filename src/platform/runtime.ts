/** Runtime detection. Native = running inside the Tauri shell (macOS app). */
export function isNative(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const platformLabel = () => (isNative() ? "macOS app" : "Navegador / PWA");
