import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare } from "lucide-react";
import { useSocketEvent } from "../lib/auth";
import { dueState } from "../lib/format";
import { useApi } from "../lib/hooks";
import type { Task } from "../lib/types";
import { Empty, ErrorBox, PageLoader } from "../components/ui";
import { TaskRow } from "../components/TaskRow";
import { TaskDrawer } from "../components/TaskDrawer";

const GROUPS = [
  { id: "overdue", label: "Overdue", cls: "text-rose-600 dark:text-rose-400" },
  { id: "soon", label: "Due in the next 3 days", cls: "text-amber-600 dark:text-amber-400" },
  { id: "later", label: "Later", cls: "" },
  { id: "none", label: "No due date", cls: "muted" },
] as const;

export function MyTasksPage() {
  const [showDone, setShowDone] = useState(false);
  const { data, error, reload } = useApi<Task[]>(`/tasks?assignee=me${showDone ? "" : "&status=backlog,todo,in_progress,review"}`);
  const [open, setOpen] = useState<string | null>(null);
  useSocketEvent<Task>("task:updated", useCallback(() => void reload(), [reload]));
  useEffect(() => {
    const r = () => void reload();
    window.addEventListener("wt:task-created", r);
    return () => window.removeEventListener("wt:task-created", r);
  }, [reload]);

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = { overdue: [], soon: [], later: [], none: [] };
    for (const t of data ?? []) {
      const s = dueState(t.dueDate, t.status);
      g[!t.dueDate ? "none" : s === "overdue" ? "overdue" : s === "soon" ? "soon" : "later"].push(t);
    }
    return g;
  }, [data]);

  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">My tasks</h1>
        <label className="ml-auto flex items-center gap-2 text-sm muted"><input type="checkbox" className="accent-indigo-600" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include done</label>
      </div>
      {!data ? <PageLoader /> : !data.length ? (
        <div className="card"><Empty icon={<CheckSquare size={36} />} title="No tasks assigned to you">Press <kbd className="rounded border px-1">N</kbd> to create one.</Empty></div>
      ) : (
        GROUPS.map((g) => grouped[g.id].length > 0 && (
          <div key={g.id} className="card overflow-hidden">
            <div className={`px-4 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase ${g.cls}`}>{g.label} · {grouped[g.id].length}</div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">{grouped[g.id].map((t) => <TaskRow key={t._id} task={t} onOpen={setOpen} />)}</div>
          </div>
        ))
      )}
      <TaskDrawer taskId={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />
    </div>
  );
}
