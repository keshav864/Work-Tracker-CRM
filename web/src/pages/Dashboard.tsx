import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, Users } from "lucide-react";
import { useAuth, useSocketEvent } from "../lib/auth";
import { fmtDate, timeAgo } from "../lib/format";
import { useApi, useTheme } from "../lib/hooks";
import type { Activity, Project, Task, UserLite } from "../lib/types";
import { Avatar, Empty, ErrorBox, PageLoader, Progress, Stat } from "../components/ui";
import { TaskRow } from "../components/TaskRow";
import { TaskDrawer } from "../components/TaskDrawer";

interface Dashboard {
  counts: { activeProjects: number; openTasks: number; overdueTasks: number; activeClients: number; completedThisWeek: number };
  hoursThisWeek: { mine: number; team: number; billable: number; nonBillable: number; byDay: { day: string; billable: number; nonBillable: number }[] };
  workload: { user: UserLite & { weeklyCapacity?: number }; openTasks: number; inProgress: number; overdue: number; estimateHours: number; loggedHours: number; capacityHours: number }[];
  overdue: Task[];
  myTasks: Task[];
  projects: (Project & { progress: number; taskCount: number; doneCount: number; hoursLogged: number; overdueCount: number })[];
  activity: Activity[];
}

export function DashboardPage() {
  const { user } = useAuth();
  const { dark } = useTheme();
  const { data, setData, error, reload } = useApi<Dashboard>("/dashboard");
  const [openTask, setOpenTask] = useState<string | null>(null);

  useSocketEvent<Activity>("activity", useCallback((a) => setData((d) => (d ? { ...d, activity: [a, ...d.activity].slice(0, 20) } : d)), [setData]));
  useEffect(() => {
    const r = () => void reload();
    window.addEventListener("wt:time-logged", r);
    window.addEventListener("wt:task-created", r);
    return () => {
      window.removeEventListener("wt:time-logged", r);
      window.removeEventListener("wt:task-created", r);
    };
  }, [reload]);

  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!data) return <PageLoader />;
  const hour = new Date().getHours();
  const grid = dark ? "#1e293b" : "#e2e8f0";
  const axis = dark ? "#94a3b8" : "#64748b";

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Good {hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, {user?.name.split(" ")[0]}</h1>
        <p className="text-sm muted">Here's what's happening across your team this week.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Hours this week (team)" value={`${data.hoursThisWeek.team}h`} sub={`You: ${data.hoursThisWeek.mine}h · ${data.hoursThisWeek.team ? Math.round((data.hoursThisWeek.billable / data.hoursThisWeek.team) * 100) : 0}% billable`} icon={<Clock size={18} />} tone="indigo" />
        <Stat label="Open tasks" value={data.counts.openTasks} sub={`${data.counts.completedThisWeek} completed this week`} icon={<CheckCircle2 size={18} />} tone="emerald" />
        <Stat label="Overdue" value={data.counts.overdueTasks} sub="Across all projects" icon={<AlertTriangle size={18} />} tone={data.counts.overdueTasks ? "rose" : "slate"} />
        <Stat label="Active projects" value={data.counts.activeProjects} sub={`${data.counts.activeClients} active clients`} icon={<FolderKanban size={18} />} tone="amber" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Hours logged this week</h2>
            <span className="text-xs muted">{data.hoursThisWeek.billable}h billable · {data.hoursThisWeek.nonBillable}h non-billable</span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.hoursThisWeek.byDay.map((d) => ({ ...d, label: new Date(d.day + "T00:00").toLocaleDateString(undefined, { weekday: "short" }) }))} margin={{ left: -20, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke={grid} />
                <XAxis dataKey="label" tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: axis, fontSize: 12 }} axisLine={false} tickLine={false} unit="h" />
                <Tooltip cursor={{ fill: dark ? "#1e293b" : "#f1f5f9" }} contentStyle={{ background: dark ? "#0f172a" : "#fff", border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => `${v}h`} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                <Bar dataKey="billable" name="Billable" stackId="h" fill="#6366f1" radius={[0, 0, 0, 0]} />
                <Bar dataKey="nonBillable" name="Non-billable" stackId="h" fill={dark ? "#475569" : "#cbd5e1"} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card flex flex-col p-4">
          <h2 className="section-title mb-3">Activity</h2>
          <div className="-mr-2 max-h-64 flex-1 space-y-3 overflow-y-auto pr-2">
            {data.activity.map((a) => (
              <div key={a._id} className="flex gap-2.5 text-sm">
                <Avatar user={a.actor} size={24} />
                <div className="min-w-0">
                  <span className="font-medium">{a.actor?.name.split(" ")[0]}</span> <span className="muted">{a.summary}</span>
                  <div className="text-[11px] muted">{timeAgo(a.createdAt)}</div>
                </div>
              </div>
            ))}
            {!data.activity.length && <Empty title="No activity yet" />}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users size={16} className="muted" />
          <h2 className="section-title">Team workload</h2>
          <span className="ml-auto text-xs muted">logged this week vs. weekly capacity</span>
        </div>
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {data.workload.map((w) => {
            const pct = (w.loggedHours / w.capacityHours) * 100;
            return (
              <div key={w.user._id} className="flex items-center gap-3">
                <Avatar user={w.user} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{w.user.name}</span>
                    <span className="text-xs whitespace-nowrap tabular-nums muted">{w.loggedHours}h / {w.capacityHours}h</span>
                  </div>
                  <Progress value={pct} color={pct > 100 ? "#e11d48" : pct > 85 ? "#f59e0b" : "#6366f1"} />
                  <div className="mt-1 flex gap-3 text-[11px] muted">
                    <span>{w.openTasks} open</span>
                    <span>{w.inProgress} in progress</span>
                    <span>{w.estimateHours}h estimated</span>
                    {w.overdue > 0 && <span className="text-rose-600 dark:text-rose-400">{w.overdue} overdue</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="section-title">My open tasks</h2>
            <Link to="/my-tasks" className="text-xs text-indigo-600 hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.myTasks.map((t) => <TaskRow key={t._id} task={t} onOpen={setOpenTask} />)}
            {!data.myTasks.length && <Empty title="Nothing assigned to you" />}
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <AlertTriangle size={15} className="text-rose-500" />
            <h2 className="section-title">Overdue tasks</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.overdue.map((t) => <TaskRow key={t._id} task={t} onOpen={setOpenTask} />)}
            {!data.overdue.length && <Empty title="No overdue work 🎉" />}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Project progress</h2>
          <Link to="/projects" className="text-xs text-indigo-600 hover:underline">All projects</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.projects.map((p) => (
            <Link key={p._id} to={`/projects/${p._id}`} className="rounded-lg border border-slate-100 p-3 transition hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-600">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                <span className="truncate text-sm font-medium">{p.name}</span>
              </div>
              <div className="mt-0.5 truncate text-xs muted">{p.client?.name ?? "Internal"}{p.dueDate ? ` · due ${fmtDate(p.dueDate)}` : ""}</div>
              <div className="mt-3 mb-1 flex justify-between text-xs">
                <span className="muted">{p.doneCount}/{p.taskCount} tasks</span>
                <span className="font-medium">{p.progress}%</span>
              </div>
              <Progress value={p.progress} color={p.color} />
              <div className="mt-2 flex justify-between text-[11px] muted">
                <span>{p.hoursLogged}h{p.budgetHours ? ` / ${p.budgetHours}h` : ""}</span>
                {p.overdueCount > 0 && <span className="text-rose-600 dark:text-rose-400">{p.overdueCount} overdue</span>}
              </div>
            </Link>
          ))}
        </div>
      </div>

      <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => void reload()} />
    </div>
  );
}
