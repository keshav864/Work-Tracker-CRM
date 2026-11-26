import { CalendarDays } from "lucide-react";
import { dueState, fmtDate, projectOf } from "../lib/format";
import type { Task } from "../lib/types";
import { Avatar, PriorityBadge, StatusBadge } from "./ui";

export function DueChip({ due, status }: { due?: string | null; status?: string }) {
  const s = dueState(due, status);
  if (!s) return null;
  const cls = s === "overdue" ? "text-rose-600 dark:text-rose-400 font-medium" : s === "soon" ? "text-amber-600 dark:text-amber-400" : "muted";
  return (
    <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${cls}`}>
      <CalendarDays size={12} /> {fmtDate(due)}
    </span>
  );
}

/** Compact list row for a task (dashboard, My tasks, list view). */
export function TaskRow({ task, onOpen, showProject = true }: { task: Task; onOpen: (id: string) => void; showProject?: boolean }) {
  const p = projectOf(task);
  return (
    <button onClick={() => onOpen(task._id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
      {showProject && p && <span className="w-16 shrink-0 font-mono text-xs" style={{ color: p.color }}>{p.key}-{task.number}</span>}
      <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
      <span className="hidden sm:inline"><StatusBadge s={task.status} /></span>
      <span className="hidden md:inline"><PriorityBadge p={task.priority} /></span>
      <span className="w-16 text-right"><DueChip due={task.dueDate} status={task.status} /></span>
      <Avatar user={task.assignee} size={24} />
    </button>
  );
}
