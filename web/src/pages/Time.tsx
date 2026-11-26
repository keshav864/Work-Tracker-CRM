import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Plus, Trash2 } from "lucide-react";
import { del, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { addDays, fmtDate, fmtHours, isoDate, startOfWeek } from "../lib/format";
import { useApi } from "../lib/hooks";
import { useTimer } from "../lib/timer";
import type { Project, Task, TimeEntry, User } from "../lib/types";
import { Avatar, Empty, ErrorBox, PageLoader, Progress, Stat, toast } from "../components/ui";

interface Timesheet {
  user: { name: string; weeklyCapacity?: number };
  weekStart: string;
  days: string[];
  rows: { key: string; project: { _id: string; name: string; key: string; color: string }; task: { _id: string; title: string; number: number } | null; days: number[]; total: number; billable: number }[];
  dayTotals: number[];
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  capacityMinutes: number;
}

export function TimePage() {
  const { user, can } = useAuth();
  const { start } = useTimer();
  const [week, setWeek] = useState(() => startOfWeek());
  const [who, setWho] = useState(user!._id);
  const weekIso = isoDate(week);
  const ts = useApi<Timesheet>(`/time/timesheet?week=${weekIso}&user=${who}`);
  const entries = useApi<TimeEntry[]>(`/time?user=${who}&from=${weekIso}&to=${isoDate(addDays(week, 6))}`);
  const { data: users } = useApi<User[]>(can("admin", "manager") ? "/users" : null);
  const { data: projects } = useApi<Project[]>("/projects?status=active");
  const [f, setF] = useState({ project: "", task: "", date: isoDate(new Date()), minutes: "60", description: "", billable: true });
  const { data: tasks } = useApi<Task[]>(f.project ? `/tasks?project=${f.project}&status=backlog,todo,in_progress,review` : null);

  useEffect(() => {
    if (!f.project && projects?.length) setF((x) => ({ ...x, project: projects[0]._id }));
  }, [projects, f.project]);
  useEffect(() => {
    const r = () => (void ts.reload(), void entries.reload());
    window.addEventListener("wt:time-logged", r);
    return () => window.removeEventListener("wt:time-logged", r);
  }, [ts.reload, entries.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMe = who === user!._id;
  const today = isoDate(new Date());
  const data = ts.data;
  const util = useMemo(() => (data ? Math.round((data.totalMinutes / data.capacityMinutes) * 100) : 0), [data]);

  const log = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post("/time", { project: f.project, task: f.task || null, date: f.date, minutes: Number(f.minutes), description: f.description || undefined, billable: f.billable });
      toast("Time logged");
      setF({ ...f, description: "" });
      void ts.reload();
      void entries.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Time</h1>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-outline p-2" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><ChevronLeft size={16} /></button>
          <button className="btn-outline" onClick={() => setWeek(startOfWeek())}>This week</button>
          <button className="btn-outline p-2" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week"><ChevronRight size={16} /></button>
        </div>
        <span className="text-sm muted">{fmtDate(weekIso)} – {fmtDate(isoDate(addDays(week, 6)), { month: "short", day: "numeric", year: "numeric" })}</span>
        {users && (
          <select className="input w-44" value={who} onChange={(e) => setWho(e.target.value)}>
            {users.map((u) => <option key={u._id} value={u._id}>{u._id === user!._id ? `${u.name} (me)` : u.name}</option>)}
          </select>
        )}
      </div>

      {ts.error && <ErrorBox error={ts.error} />}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total this week" value={fmtHours(data.totalMinutes)} sub={`${util}% of ${data.capacityMinutes / 60}h capacity`} tone="indigo" />
          <Stat label="Billable" value={fmtHours(data.billableMinutes)} sub={data.totalMinutes ? `${Math.round((data.billableMinutes / data.totalMinutes) * 100)}% of total` : "—"} tone="emerald" />
          <Stat label="Non-billable" value={fmtHours(data.nonBillableMinutes)} tone="slate" />
          <div className="card flex flex-col justify-center gap-2 p-4">
            <div className="text-xs muted">Utilization</div>
            <Progress value={util} color={util > 100 ? "#e11d48" : "#6366f1"} />
            <div className="text-xs muted">{data.user.name}</div>
          </div>
        </div>
      )}

      {isMe && (
        <form onSubmit={log} className="card flex flex-wrap items-end gap-2 p-4">
          <div className="min-w-40 flex-1"><label className="label">Project</label><select className="input" required value={f.project} onChange={(e) => setF({ ...f, project: e.target.value, task: "" })}>{projects?.map((p) => <option key={p._id} value={p._id}>{p.key} · {p.name}</option>)}</select></div>
          <div className="min-w-48 flex-[2]"><label className="label">Task (optional)</label><select className="input" value={f.task} onChange={(e) => setF({ ...f, task: e.target.value })}><option value="">— General project time —</option>{tasks?.map((t) => <option key={t._id} value={t._id}>#{t.number} {t.title}</option>)}</select></div>
          <div><label className="label">Date</label><input type="date" className="input w-36" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div><label className="label">Duration</label><select className="input w-24" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })}>{[15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => <option key={m} value={m}>{fmtHours(m)}</option>)}</select></div>
          <div className="min-w-40 flex-[2]"><label className="label">Description</label><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What did you work on?" /></div>
          <label className="flex h-[38px] items-center gap-1.5 text-sm"><input type="checkbox" className="accent-indigo-600" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable</label>
          <button className="btn-primary"><Plus size={15} /> Log</button>
          <button type="button" className="btn-outline" disabled={!f.project} onClick={() => start({ project: f.project, task: f.task || undefined, description: f.description || undefined }).catch((err) => toast(err.message, "error"))}><Play size={14} /> Start timer</button>
        </form>
      )}

      <div className="card overflow-x-auto">
        {!data ? <PageLoader /> : (
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b border-slate-100 text-xs muted dark:border-slate-800">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Project / task</th>
                {data.days.map((d) => <th key={d} className={`w-12 text-center font-medium ${d === today ? "text-indigo-600 dark:text-indigo-400" : ""}`}>{new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short" })}<div className="font-normal">{new Date(d + "T00:00").getDate()}</div></th>)}
                <th className="w-20 pr-4 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.rows.map((r) => (
                <tr key={r.key}>
                  <td className="max-w-80 px-4 py-2">
                    <div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.project?.color }} /><span className="truncate">{r.task ? r.task.title : <span className="muted">General</span>}</span></div>
                    <div className="pl-4 text-xs muted">{r.project?.key}{r.task ? `-${r.task.number}` : ""} · {r.project?.name}</div>
                  </td>
                  {r.days.map((m, i) => <td key={i} className={`text-center tabular-nums ${m ? "" : "text-slate-300 dark:text-slate-700"}`}>{m ? (m / 60).toFixed(1) : "–"}</td>)}
                  <td className="pr-4 text-right font-medium tabular-nums">{(r.total / 60).toFixed(1)}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={9}><Empty title="No time logged this week" /></td></tr>}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
              <tr><td className="px-4 py-2.5">Total</td>{data.dayTotals.map((m, i) => <td key={i} className="text-center tabular-nums">{(m / 60).toFixed(1)}</td>)}<td className="pr-4 text-right tabular-nums">{(data.totalMinutes / 60).toFixed(1)}h</td></tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 pt-4 pb-2 section-title">Entries</div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {entries.data?.map((e) => (
            <div key={e._id} className="group flex items-center gap-3 px-4 py-2 text-sm">
              <Avatar user={e.user} size={22} />
              <span className="w-20 shrink-0 text-xs muted">{fmtDate(e.startedAt, { weekday: "short", day: "numeric" })}</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.project?.color }} />
              <span className="min-w-0 flex-1 truncate">{e.task?.title ?? e.project?.name}{e.description && <span className="muted"> — {e.description}</span>}</span>
              {!e.billable && <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800">non-billable</span>}
              <span className="chip bg-slate-50 text-slate-500 dark:bg-slate-800/60">{e.source}</span>
              <span className="w-16 text-right font-medium tabular-nums">{e.endedAt ? fmtHours(e.minutes) : "running"}</span>
              {(isMe || can("admin", "manager")) && e.endedAt && (
                <button className="opacity-0 group-hover:opacity-100 muted hover:text-rose-600" title="Delete entry" onClick={async () => { await del(`/time/${e._id}`); void ts.reload(); void entries.reload(); }}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
          {entries.data && !entries.data.length && <Empty title="No entries" />}
        </div>
      </div>
    </div>
  );
}
