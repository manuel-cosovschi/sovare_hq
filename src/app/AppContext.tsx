import * as React from "react";
import type { Profile } from "@/db";

export type QuickKind = "income" | "expense" | "task" | "project" | null;

export interface AppState {
  profile: Profile;
  switchProfile: (p: Profile) => Promise<void>;
  previousVisit: string | null;
  reportingCurrency: string;
  setReportingCurrency: (c: string) => void;
  quick: { kind: QuickKind; preset?: Record<string, unknown> };
  openQuick: (kind: QuickKind, preset?: Record<string, unknown>) => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const AppCtx = React.createContext<AppState | null>(null);

export function useApp(): AppState {
  const c = React.useContext(AppCtx);
  if (!c) throw new Error("AppCtx missing");
  return c;
}

export type ThemePref = "system" | "light" | "dark";

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem("sovare.theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem("sovare.theme", pref);
  } catch {
    /* ignore */
  }
  applyTheme(pref);
}
