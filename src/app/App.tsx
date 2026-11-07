import * as React from "react";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import * as RTooltip from "@radix-ui/react-tooltip";
import { AppCtx, applyTheme, readTheme, type AppState, type QuickKind } from "./AppContext";
import { Layout, Mark } from "./Layout";
import { FeedbackProvider } from "@/components/ui/feedback";
import { openDatabase, storedProfile, type Profile } from "@/db";
import { getPref, setPref } from "@/repos/core";
import { startScheduler, refreshTray } from "./scheduler";
import { onTrayAction } from "@/platform/notify";
import { Skeleton } from "@/components/ui/primitives";

const Overview = React.lazy(() => import("@/features/overview/OverviewPage"));
const Projects = React.lazy(() => import("@/features/projects/ProjectsPage"));
const ProjectDetail = React.lazy(() => import("@/features/projects/ProjectDetailPage"));
const Finance = React.lazy(() => import("@/features/finance/FinancePage"));
const Analytics = React.lazy(() => import("@/features/analytics/AnalyticsPage"));
const Marketing = React.lazy(() => import("@/features/marketing/MarketingPage"));
const Development = React.lazy(() => import("@/features/development/DevelopmentPage"));
const AiInsights = React.lazy(() => import("@/features/ai/AiPage"));
const Tasks = React.lazy(() => import("@/features/tasks/TasksPage"));
const ActivityPage = React.lazy(() => import("@/features/activity/ActivityPage"));
const Integrations = React.lazy(() => import("@/features/integrations/IntegrationsPage"));
const Settings = React.lazy(() => import("@/features/settings/SettingsPage"));
const Onboarding = React.lazy(() => import("@/features/onboarding/OnboardingPage"));

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } });

function PageFallback() {
  return (
    <div className="space-y-4 pt-6">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <p className="text-[15px] font-semibold">Algo salió mal en esta pantalla</p>
        <p className="mt-2 break-words text-[12.5px] text-ink-3">{this.state.error.message}</p>
        <button className="mt-4 text-[13px] font-medium text-accent" onClick={() => this.setState({ error: null })}>
          Reintentar
        </button>
      </div>
    );
  }
}

function TrayBridge() {
  const nav = useNavigate();
  const ctx = React.useContext(AppCtx)!;
  React.useEffect(() => {
    let off: (() => void) | undefined;
    void onTrayAction((a) => {
      if (a.startsWith("nav:")) nav(a.slice(4));
      else if (a === "action:expense") ctx.openQuick("expense");
      else if (a === "action:income") ctx.openQuick("income");
      else if (a === "action:task") ctx.openQuick("task");
      else if (a === "action:search") ctx.setPaletteOpen(true);
    }).then((u) => (off = u));
    return () => off?.();
  }, [nav, ctx]);
  return null;
}

function Shell({ profile, onSwitch, previousVisit, onboarded }: { profile: Profile; onSwitch: (p: Profile) => Promise<void>; previousVisit: string | null; onboarded: boolean }) {
  const qc = useQueryClient();
  const [quick, setQuick] = React.useState<{ kind: QuickKind; preset?: Record<string, unknown> }>({ kind: null });
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem("sovare.sidebar") === "collapsed");
  const [reportingCurrency, setRC] = React.useState("USD");

  React.useEffect(() => {
    void getPref("finance.reporting_currency", "USD").then(setRC);
    startScheduler(() => void qc.invalidateQueries());
  }, [profile, qc]);

  const value: AppState = {
    profile,
    switchProfile: onSwitch,
    previousVisit,
    reportingCurrency,
    setReportingCurrency: (c) => {
      setRC(c);
      void setPref("finance.reporting_currency", c).then(() => qc.invalidateQueries());
    },
    quick,
    openQuick: (kind, preset) => setQuick({ kind, preset }),
    paletteOpen,
    setPaletteOpen,
    sidebarCollapsed: collapsed,
    toggleSidebar: () =>
      setCollapsed((c) => {
        localStorage.setItem("sovare.sidebar", c ? "expanded" : "collapsed");
        return !c;
      }),
  };

  return (
    <AppCtx.Provider value={value}>
      <HashRouter>
        <TrayBridge />
        <ErrorBoundary>
          <React.Suspense fallback={<div className="p-8"><PageFallback /></div>}>
            <Routes>
              <Route path="/onboarding" element={<Onboarding />} />
              <Route element={onboarded ? <Layout /> : <Navigate to="/onboarding" replace />}>
                <Route index element={<React.Suspense fallback={<PageFallback />}><Overview /></React.Suspense>} />
                <Route path="projects" element={<Projects />} />
                <Route path="projects/:id" element={<ProjectDetail />} />
                <Route path="finance" element={<Finance />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="marketing" element={<Marketing />} />
                <Route path="development" element={<Development />} />
                <Route path="ai" element={<AiInsights />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="integrations" element={<Integrations />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </React.Suspense>
        </ErrorBoundary>
      </HashRouter>
    </AppCtx.Provider>
  );
}

export function App() {
  const [state, setState] = React.useState<{ profile: Profile; previousVisit: string | null; onboarded: boolean; key: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const boot = React.useCallback(async (profile: Profile) => {
    try {
      await openDatabase(profile);
      const previousVisit = await getPref<string | null>("app.last_visit", null);
      await setPref("app.last_visit", new Date().toISOString());
      const onboarded = profile === "demo" || (await getPref<boolean>("onboarding.completed", false));
      queryClient.clear();
      setState((s) => ({ profile, previousVisit, onboarded, key: (s?.key ?? 0) + 1 }));
      void refreshTray().catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    applyTheme(readTheme());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(readTheme());
    mq.addEventListener("change", onChange);
    void boot(storedProfile());
    return () => mq.removeEventListener("change", onChange);
  }, [boot]);

  React.useEffect(() => {
    const onDone = () => setState((s) => (s ? { ...s, onboarded: true } : s));
    window.addEventListener("sovare:onboarded", onDone);
    return () => window.removeEventListener("sovare:onboarded", onDone);
  }, []);

  if (error)
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-[15px] font-semibold">No se pudo abrir la base de datos</p>
          <p className="mt-2 max-w-md text-[12.5px] text-ink-3">{error}</p>
        </div>
      </div>
    );
  if (!state)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" aria-busy="true">
        <Mark size={44} />
        <p className="text-[12px] text-ink-3">Abriendo Sovare HQ…</p>
      </div>
    );

  return (
    <QueryClientProvider client={queryClient}>
      <RTooltip.Provider>
        <FeedbackProvider>
          <Shell key={state.key} profile={state.profile} onSwitch={boot} previousVisit={state.previousVisit} onboarded={state.onboarded} />
        </FeedbackProvider>
      </RTooltip.Provider>
    </QueryClientProvider>
  );
}
