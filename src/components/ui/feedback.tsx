import * as React from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { Button, Dialog } from "./primitives";
import { cx } from "@/lib/util";

type ToastTone = "success" | "danger" | "info" | "warning";
interface ToastItem {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ConfirmOpts {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

const Ctx = React.createContext<{ show: (t: Omit<ToastItem, "id">) => void; confirm: (o: ConfirmOpts) => Promise<boolean> } | null>(null);

export function useToast() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("FeedbackProvider missing");
  return c;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [confirmState, setConfirm] = React.useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const idRef = React.useRef(0);

  const show = React.useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++idRef.current;
    setToasts((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), t.tone === "danger" ? 7000 : 4000);
  }, []);
  const confirm = React.useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const value = React.useMemo(() => ({ show, confirm }), [show, confirm]);
  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirm(null);
  };
  const Icon = { success: CheckCircle2, danger: XCircle, info: Info, warning: AlertTriangle };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[340px] flex-col gap-2">
        {toasts.map((t) => {
          const I = Icon[t.tone];
          return (
            <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-[var(--shadow-lg)] animate-fade">
              <I className={cx("mt-px size-4 shrink-0", t.tone === "success" && "text-success", t.tone === "danger" && "text-danger", t.tone === "info" && "text-info", t.tone === "warning" && "text-warning")} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 break-words text-[12px] text-ink-3">{t.body}</p>}
                {t.action && (
                  <button className="mt-1 text-[12px] font-medium text-accent" onClick={t.action.onClick}>
                    {t.action.label}
                  </button>
                )}
              </div>
              <button aria-label="Cerrar" className="text-ink-3 hover:text-ink" onClick={() => setToasts((s) => s.filter((x) => x.id !== t.id))}>
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <Dialog
        open={!!confirmState}
        onOpenChange={(o) => !o && close(false)}
        title={confirmState?.title ?? ""}
        width={420}
        footer={
          <>
            <Button onClick={() => close(false)}>Cancelar</Button>
            <Button variant={confirmState?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {confirmState?.confirmLabel ?? "Confirmar"}
            </Button>
          </>
        }
      >
        <div className="pb-2 text-[13px] text-ink-2">{confirmState?.body}</div>
      </Dialog>
    </Ctx.Provider>
  );
}
