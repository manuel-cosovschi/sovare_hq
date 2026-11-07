import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useToast } from "@/components/ui/feedback";
import { activeProfile } from "@/db";

/** Query wrapper: keys are namespaced by DB profile so demo and real data never share cache. */
export function useData<T>(key: QueryKey, fn: () => Promise<T>, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({ queryKey: [activeProfile(), ...(key as unknown[])], queryFn: fn, ...opts });
}

/** Mutation helper: toasts errors, optional success message, refreshes local data afterwards. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string | ((r: R) => string | null); error?: string } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: (r) => {
      const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
      if (msg) toast.show({ title: msg, tone: "success" });
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.show({ title: opts.error ?? "No se pudo completar la acción", body: e.message, tone: "danger" }),
  });
  return { run: (...args: A) => m.mutateAsync(args).catch(() => undefined as R | undefined), pending: m.isPending };
}

export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
