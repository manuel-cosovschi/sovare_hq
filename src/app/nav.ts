import { Activity, BarChart3, Code2, FolderKanban, LayoutDashboard, ListChecks, Megaphone, Plug, Settings, Sparkles, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, shortcut: "1" },
  { to: "/projects", label: "Projects", icon: FolderKanban, shortcut: "2" },
  { to: "/finance", label: "Finance", icon: Wallet, shortcut: "3" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, shortcut: "4" },
  { to: "/marketing", label: "Marketing", icon: Megaphone, shortcut: "5" },
  { to: "/development", label: "Development", icon: Code2, shortcut: "6" },
  { to: "/ai", label: "AI Insights", icon: Sparkles, shortcut: "7" },
  { to: "/tasks", label: "Tasks & Roadmap", icon: ListChecks, shortcut: "8" },
  { to: "/activity", label: "Activity", icon: Activity, shortcut: "9" },
  { to: "/integrations", label: "Integrations", icon: Plug, shortcut: "0" },
  { to: "/settings", label: "Settings", icon: Settings, shortcut: "," },
];
