import { useApp } from "./AppContext";
import { TransactionDialog } from "@/features/finance/TransactionDialog";
import { TaskDialog } from "@/features/tasks/TaskDialog";
import { ProjectDialog } from "@/features/projects/ProjectDialog";

export function QuickDialogs() {
  const app = useApp();
  const close = () => app.openQuick(null);
  const k = app.quick.kind;
  const preset = app.quick.preset as Record<string, string> | undefined;
  return (
    <>
      <TransactionDialog open={k === "income" || k === "expense"} kind={k === "income" ? "income" : "expense"} onClose={close} preset={preset} />
      <TaskDialog open={k === "task"} onClose={close} preset={preset} />
      <ProjectDialog open={k === "project"} onClose={close} preset={preset} />
    </>
  );
}
