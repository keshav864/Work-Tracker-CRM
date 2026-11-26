import { useCallback, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, CheckSquare, Clock, Copy, FileText, KanbanSquare, List, MessageSquare, Paperclip, Plus, Search, Settings, Sparkles } from "lucide-react";
import { patch, post } from "../lib/api";
import { useAuth, useSocketEvent } from "../lib/auth";
import { fmtDate, fmtHours, isoDate } from "../lib/format";
import { useApi } from "../lib/hooks";
import { STATUSES, type ClientT, type Project, type Status, type Task, type User } from "../lib/types";
import { Avatar, ErrorBox, Label, Modal, PageLoader, PriorityBadge, Progress, Spinner, toast } from "../components/ui";
import { DueChip, TaskRow } from "../components/TaskRow";
import { TaskDrawer } from "../components/TaskDrawer";
import { NewTaskModal } from "../components/NewTaskModal";

const projectIdOf = (t: Task) => (typeof t.project === "object" ? t.project._id : t.project);

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data: project, error, reload: reloadProject } = useApi<Project>(`/projects/${id}`);
  const { data: tasks, setData: setTasks } = useApi<Task[]>(`/tasks?project=${id}`);
  const { data: users } = useApi<User[]>("/users");
  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState("");
  const [newIn, setNewIn] = useState<Status | null>(null);
  const [report, setReport] = useState<{ markdown: string; mode: string; warning?: string } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const openTask = params.get("task");
  const setOpenTask = (tid: string | null) => setParams(tid ? { task: tid } : {}, { replace: true });

  // ---- real-time: teammates' changes stream in over Socket.IO ----
  const upsert = useCallback(
    (t: Task) => {
      if (projectIdOf(t) !== id) return;
      setTasks((xs) => (xs ? (xs.some((x) => x._id === t._id) ? xs.map((x) => (x._id === t._id ? { ...x, ...t } : x)) : [...xs, t]) : xs));
    },
    [id, setTasks],
  );
  useSocketEvent<Task>("task:created", upsert);
  useSocketEvent<Task>("task:updated", upsert);
  useSocketEvent<{ _id: string }>("task:deleted", useCallback((e) => setTasks((xs) => xs?.filter((x) => x._id !== e._id) ?? xs), [setTasks]));
  useSocketEvent<{ taskId: string }>("comment:created", useCallback((e) => setTasks((xs) => xs?.map((x) => (x._id === e.taskId ? { ...x, commentCount: (x.commentCount ?? 0) + 1 } : x)) ?? xs), [setTasks]));

  const filtered = useMemo(() => {
    const term = q.toLowerCase();
    return (tasks ?? []).filter((t) => (!term || t.title.toLowerCase().includes(term) || t.labels.some((l) => l.includes(term)) || `${project?.key}-${t.number}`.toLowerCase() === term) && (!assignee || (assignee === "none" ? !t.assignee : t.assignee?._id === assignee)));
  }, [tasks, q, assignee, project?.key]);

  const columns = useMemo(() => {
    const by = Object.fromEntries(STATUSES.map((s) => [s.id, [] as Task[]])) as Record<Status, Task[]>;
    for (const t of filtered) by[t.status]?.push(t);
    for (const s of STATUSES) by[s.id].sort((a, b) => a.order - b.order);
    return by;
  }, [filtered]);

  // ---- drag & drop (HTML5) with fractional ordering ----
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: Status; index: number } | null>(null);

  const onDrop = async (status: Status) => {
    if (!drag || !over || !tasks) return;
    const moving = tasks.find((t) => t._id === drag);
    setDrag(null);
    setOver(null);
    if (!moving) return;
    const col = columns[status].filter((t) => t._id !== drag);
    const index = Math.min(over.index, col.length);
    const before = col[index - 1]?.order;
    const after = col[index]?.order;
    const order = before === undefined && after === undefined ? 1000 : before === undefined ? after! - 1000 : after === undefined ? before + 1000 : (before + after) / 2;
    if (moving.status === status && moving.order === order) return;
    const prev = tasks;
    setTasks(tasks.map((t) => (t._id === drag ? { ...t, status, order } : t))); // optimistic
    try {
      upsert(await post<Task>(`/tasks/${drag}/move`, { status, order }));
    } catch (e) {
      setTasks(prev);
      toast((e as Error).message, "error");
    }
  };

  const onDragOverColumn = (e: React.DragEvent, status: Status) => {
    e.preventDefault();
    const cards = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-card]")].filter((c) => c.dataset.card !== drag);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    if (over?.status !== status || over.index !== index) setOver({ status, index });
  };

  const genReport = async () => {
    setReporting(true);
    try {
      setReport(await post(`/ai/status-report`, { project: id }));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setReporting(false);
    }
  };

  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!project || !tasks) return <PageLoader />;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start gap-3">
          <Link to="/projects" className="btn-ghost mt-0.5 p-1.5"><ArrowLeft size={16} /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded" style={{ background: project.color }} />
              <h1 className="truncate text-lg font-semibold">{project.name}</h1>
              <span className="font-mono text-xs muted">{project.key}</span>
              <span className="chip bg-slate-100 capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{project.status.replace("_", " ")}</span>
            </div>
            <div className="mt-0.5 text-sm muted">
              {project.client ? <Link className="hover:underline" to={`/clients/${project.client._id}`}>{project.client.name}</Link> : "Internal"}
              {project.dueDate && <> · due {fmtDate(project.dueDate, { month: "short", day: "numeric", year: "numeric" })}</>}
              {" · "}{project.hoursLogged}h logged{project.budgetHours ? ` of ${project.budgetHours}h` : ""}
            </div>
          </div>
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <div className="hidden -space-x-1.5 sm:flex">{project.members?.slice(0, 5).map((m) => <Avatar key={m._id} user={m} size={26} />)}</div>
            <button className="btn-ai" onClick={genReport} disabled={reporting}>{reporting ? <Spinner /> : <Sparkles size={15} />} Status report</button>
            {can("admin", "manager") && <button className="btn-outline p-2" onClick={() => setSettings(true)} title="Project settings"><Settings size={16} /></button>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40 sm:w-56"><Progress value={project.progress ?? 0} color={project.color} /></div>
          <span className="text-xs muted">{project.progress}% · {project.doneCount}/{project.taskCount} done</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute top-2.5 left-2.5 muted" />
            <input className="input w-48 pl-8 sm:w-60" placeholder="Search tasks or labels" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-40" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {users?.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </select>
          <div className="ml-auto flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
            <button className={`btn btn-sm ${view === "board" ? "bg-slate-100 dark:bg-slate-800" : ""}`} onClick={() => setView("board")}><KanbanSquare size={14} /> Board</button>
            <button className={`btn btn-sm ${view === "list" ? "bg-slate-100 dark:bg-slate-800" : ""}`} onClick={() => setView("list")}><List size={14} /> List</button>
          </div>
        </div>
      </div>

      {view === "board" ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 sm:p-6">
          {STATUSES.map((s) => (
            <div
              key={s.id}
              className={`flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/70 transition dark:bg-slate-900/60 ${over?.status === s.id ? "ring-2 ring-indigo-400/60" : ""}`}
              onDragOver={(e) => onDragOverColumn(e, s.id)}
              onDrop={(e) => (e.preventDefault(), onDrop(s.id))}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                <span className="text-sm font-semibold">{s.label}</span>
                <span className="text-xs muted">{columns[s.id].length}</span>
                <button className="btn-ghost ml-auto p-1" onClick={() => setNewIn(s.id)} title={`Add to ${s.label}`}><Plus size={15} /></button>
              </div>
              <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {columns[s.id].map((t, i) => (
                  <div key={t._id}>
                    {drag && over?.status === s.id && over.index === i && <div className="mb-2 h-1 rounded bg-indigo-400" />}
                    <TaskCard task={t} projectKey={project.key} dragging={drag === t._id} onOpen={() => setOpenTask(t._id)} onDragStart={() => setDrag(t._id)} onDragEnd={() => (setDrag(null), setOver(null))} />
                  </div>
                ))}
                {drag && over?.status === s.id && over.index >= columns[s.id].filter((t) => t._id !== drag).length && <div className="h-1 rounded bg-indigo-400" />}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 sm:p-6">
          <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
            {STATUSES.map((s) => columns[s.id].length > 0 && (
              <div key={s.id}>
                <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 text-xs font-semibold tracking-wide uppercase dark:bg-slate-800/40">
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label} <span className="muted">{columns[s.id].length}</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {columns[s.id].map((t) => <TaskRow key={t._id} task={{ ...t, project: { _id: project._id, key: project.key, name: project.name, color: project.color } }} onOpen={setOpenTask} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <TaskDrawer
        taskId={openTask}
        onClose={() => setOpenTask(null)}
        onChanged={(t) => {
          if ("deleted" in t) setTasks((xs) => xs?.filter((x) => x._id !== t._id) ?? xs);
          else upsert(t);
          void reloadProject();
        }}
      />
      <NewTaskModal open={!!newIn} onClose={() => setNewIn(null)} defaultProject={project._id} defaultStatus={newIn ?? undefined} onCreated={upsert} />
      <Modal open={!!report} onClose={() => setReport(null)} title={<span className="flex items-center gap-2"><FileText size={16} /> Weekly status report</span>} wide>
        {report && (
          <>
            {report.warning && <div className="mb-2"><ErrorBox error={`Claude unavailable (${report.warning}) — showing the offline report.`} /></div>}
            <div className="prose-wt max-h-[60vh] overflow-y-auto text-sm"><ReactMarkdown>{report.markdown}</ReactMarkdown></div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs muted">{report.mode === "live" ? "Written by Claude from live project data" : "Generated offline from project data (demo mode)"}</span>
              <button className="btn-outline" onClick={() => navigator.clipboard.writeText(report.markdown).then(() => toast("Copied as Markdown"))}><Copy size={14} /> Copy</button>
            </div>
          </>
        )}
      </Modal>
      {settings && <ProjectSettings project={project} onClose={() => setSettings(false)} onSaved={() => (setSettings(false), reloadProject())} />}
    </div>
  );
}

function TaskCard({ task, projectKey, dragging, onOpen, onDragStart, onDragEnd }: { task: Task; projectKey: string; dragging: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  const subDone = task.subtasks.filter((s) => s.done).length;
  return (
    <div
      data-card={task._id}
      draggable
      onDragStart={(e) => (e.dataTransfer.setData("text/plain", task._id), (e.dataTransfer.effectAllowed = "move"), onDragStart())}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`card cursor-grab p-3 transition hover:border-slate-300 hover:shadow active:cursor-grabbing dark:hover:border-slate-600 ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] muted">{projectKey}-{task.number}</span>
        <PriorityBadge p={task.priority} />
      </div>
      <div className="mt-1 text-sm leading-snug font-medium">{task.title}</div>
      {task.labels.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{task.labels.slice(0, 3).map((l) => <Label key={l}>{l}</Label>)}</div>}
      <div className="mt-2.5 flex items-center gap-2.5 text-xs muted">
        <DueChip due={task.dueDate} status={task.status} />
        {task.subtasks.length > 0 && <span className="inline-flex items-center gap-1"><CheckSquare size={12} />{subDone}/{task.subtasks.length}</span>}
        {!!task.commentCount && <span className="inline-flex items-center gap-1"><MessageSquare size={12} />{task.commentCount}</span>}
        {task.attachments.length > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} />{task.attachments.length}</span>}
        {!!task.loggedMinutes && <span className="inline-flex items-center gap-1"><Clock size={12} />{fmtHours(task.loggedMinutes)}</span>}
        <span className="ml-auto"><Avatar user={task.assignee} size={22} /></span>
      </div>
    </div>
  );
}

function ProjectSettings({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const { data: clients } = useApi<ClientT[]>("/clients");
  const [f, setF] = useState({
    name: project.name,
    status: project.status,
    client: project.client?._id ?? "",
    dueDate: project.dueDate ? isoDate(new Date(project.dueDate)) : "",
    budgetHours: project.budgetHours?.toString() ?? "",
    hourlyRate: project.hourlyRate?.toString() ?? "",
    billable: project.billable ?? true,
    color: project.color,
    description: project.description ?? "",
  });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await patch(`/projects/${project._id}`, { ...f, client: f.client || null, dueDate: f.dueDate || null, budgetHours: f.budgetHours ? Number(f.budgetHours) : null, hourlyRate: f.hourlyRate ? Number(f.hourlyRate) : null });
      toast("Project saved");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="Project settings" wide>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="label">Name</label><input className="input" required value={f.name} onChange={set("name")} /></div>
        <div className="col-span-2"><label className="label">Description</label><textarea className="input" value={f.description} onChange={set("description")} /></div>
        <div><label className="label">Status</label><select className="input" value={f.status} onChange={set("status")}>{["planning", "active", "on_hold", "completed", "archived"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
        <div><label className="label">Client</label><select className="input" value={f.client} onChange={set("client")}><option value="">Internal (no client)</option>{clients?.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select></div>
        <div><label className="label">Due date</label><input className="input" type="date" value={f.dueDate} onChange={set("dueDate")} /></div>
        <div><label className="label">Budget (hours)</label><input className="input" type="number" min="0" value={f.budgetHours} onChange={set("budgetHours")} /></div>
        <div><label className="label">Hourly rate override</label><input className="input" type="number" min="0" value={f.hourlyRate} onChange={set("hourlyRate")} placeholder="Uses client rate" /></div>
        <div><label className="label">Color</label><input className="input h-[38px] p-1" type="color" value={f.color} onChange={set("color")} /></div>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-600" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Time on this project is billable by default</label>
        <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
