import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FolderKanban, Plus } from "lucide-react";
import { post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useApi } from "../lib/hooks";
import type { ClientT, Project } from "../lib/types";
import { Avatar, Empty, ErrorBox, Modal, PageLoader, Progress, toast } from "../components/ui";

const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  planning: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  on_hold: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  completed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  archived: "bg-slate-100 text-slate-500 dark:bg-slate-800",
};

export function ProjectsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const { data, error } = useApi<Project[]>(`/projects${status ? `?status=${status}` : ""}`);
  const [creating, setCreating] = useState(false);
  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Projects</h1>
        <select className="input ml-auto w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All (not archived)</option>
          {["planning", "active", "on_hold", "completed", "archived"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        {can("admin", "manager") && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New project</button>}
      </div>
      {!data ? (
        <PageLoader />
      ) : data.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => {
            const burn = p.budgetHours ? Math.round(((p.hoursLogged ?? 0) / p.budgetHours) * 100) : null;
            return (
              <Link key={p._id} to={`/projects/${p._id}`} className="card group p-4 transition hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: p.color }}>{p.key.slice(0, 3)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium group-hover:text-indigo-600">{p.name}</div>
                    <div className="truncate text-xs muted">{p.client?.name ?? "Internal"}</div>
                  </div>
                  <span className={`chip capitalize ${STATUS_CLS[p.status]}`}>{p.status.replace("_", " ")}</span>
                </div>
                {p.description && <p className="mt-3 line-clamp-2 text-sm muted">{p.description}</p>}
                <div className="mt-4 mb-1 flex justify-between text-xs"><span className="muted">{p.doneCount}/{p.taskCount} tasks done</span><span className="font-medium">{p.progress}%</span></div>
                <Progress value={p.progress ?? 0} color={p.color} />
                <div className="mt-3 flex items-center justify-between text-xs muted">
                  <span>{p.hoursLogged}h{p.budgetHours ? ` / ${p.budgetHours}h (${burn}%)` : " logged"}</span>
                  {p.overdueCount ? <span className="text-rose-600 dark:text-rose-400">{p.overdueCount} overdue</span> : p.dueDate ? <span>Due {fmtDate(p.dueDate)}</span> : null}
                  <div className="flex -space-x-1.5">{p.members?.slice(0, 4).map((m) => <Avatar key={m._id} user={m} size={22} />)}</div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card"><Empty icon={<FolderKanban size={36} />} title="No projects yet">Create a project to start tracking tasks and time.</Empty></div>
      )}
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}

export function NewProjectModal({ onClose, defaultClient }: { onClose: () => void; defaultClient?: string }) {
  const nav = useNavigate();
  const { data: clients } = useApi<ClientT[]>("/clients");
  const [f, setF] = useState({ name: "", key: "", client: defaultClient ?? "", dueDate: "", budgetHours: "", color: "#6366f1", description: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await post<Project>("/projects", { name: f.name, key: f.key || undefined, client: f.client || null, dueDate: f.dueDate || null, budgetHours: f.budgetHours ? Number(f.budgetHours) : null, color: f.color, description: f.description || undefined });
      toast("Project created");
      nav(`/projects/${p._id}`);
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="New project" wide>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1"><label className="label">Name</label><input className="input" required value={f.name} onChange={set("name")} autoFocus /></div>
        <div className="col-span-2 sm:col-span-1"><label className="label">Key (for task IDs)</label><input className="input uppercase" maxLength={6} placeholder="Auto" value={f.key} onChange={set("key")} /></div>
        <div className="col-span-2"><label className="label">Description</label><textarea className="input" value={f.description} onChange={set("description")} /></div>
        <div><label className="label">Client</label><select className="input" value={f.client} onChange={set("client")}><option value="">Internal (no client)</option>{clients?.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select></div>
        <div><label className="label">Due date</label><input className="input" type="date" value={f.dueDate} onChange={set("dueDate")} /></div>
        <div><label className="label">Budget (hours)</label><input className="input" type="number" min="0" value={f.budgetHours} onChange={set("budgetHours")} /></div>
        <div><label className="label">Color</label><input className="input h-[38px] p-1" type="color" value={f.color} onChange={set("color")} /></div>
        <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Create project</button></div>
      </form>
    </Modal>
  );
}
