import { useCallback, useEffect, useState } from "react";
import { Calculator, CheckSquare, Clock, ListChecks, MessageSquare, Paperclip, Play, Plus, Sparkles, Square, Trash2, X } from "lucide-react";
import { api, del, patch, post } from "../lib/api";
import { useAuth, useSocketEvent } from "../lib/auth";
import { fmtDate, fmtHours, isoDate, timeAgo } from "../lib/format";
import { useApi } from "../lib/hooks";
import { useTimer } from "../lib/timer";
import { PRIORITIES, STATUSES, type Comment, type Task, type TaskDetail, type TimeEntry, type User } from "../lib/types";
import { Avatar, Drawer, ErrorBox, Label, PageLoader, Progress, Spinner, toast } from "./ui";

type Estimate = { hours: number; low: number; high: number; confidence: string; rationale: string; mode: string; warning?: string };

export function TaskDrawer({ taskId, onClose, onChanged }: { taskId: string | null; onClose: () => void; onChanged?: (t: Task | { _id: string; deleted: true }) => void }) {
  const { user, can } = useAuth();
  const { running, start, stop } = useTimer();
  const { data: task, setData: setTask, error, reload } = useApi<TaskDetail>(taskId ? `/tasks/${taskId}` : null);
  const { data: users } = useApi<User[]>(taskId ? "/users" : null);
  const [comment, setComment] = useState("");
  const [newSub, setNewSub] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [suggest, setSuggest] = useState<{ subtasks: string[]; mode: string } | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState({ date: isoDate(new Date()), minutes: "60", description: "" });
  const [att, setAtt] = useState({ name: "", url: "" });

  useEffect(() => {
    setSuggest(null);
    setEstimate(null);
    setComment("");
  }, [taskId]);

  // live updates from teammates
  useSocketEvent<Task>("task:updated", useCallback((t) => t._id === taskId && setTask((cur) => (cur ? { ...cur, ...t, comments: cur.comments, timeEntries: cur.timeEntries } : cur)), [taskId, setTask]));
  useSocketEvent<{ taskId: string; comment: Comment }>(
    "comment:created",
    useCallback((e) => e.taskId === taskId && setTask((cur) => (cur && !cur.comments.some((c) => c._id === e.comment._id) ? { ...cur, comments: [...cur.comments, e.comment] } : cur)), [taskId, setTask]),
  );

  const apply = (t: Task) => {
    setTask((cur) => (cur ? { ...cur, ...t, comments: cur.comments, timeEntries: cur.timeEntries } : cur));
    onChanged?.(t);
  };
  const update = async (body: Record<string, unknown>) => {
    try {
      apply(await patch<Task>(`/tasks/${taskId}`, body));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  if (!taskId) return null;
  const project = task && typeof task.project === "object" ? task.project : null;
  const subDone = task?.subtasks.filter((s) => s.done).length ?? 0;
  const timerHere = running?.task?._id === taskId;

  return (
    <Drawer open={!!taskId} onClose={onClose}>
      {error && <div className="p-5"><ErrorBox error={error} /></div>}
      {!task && !error && <PageLoader />}
      {task && (
        <div className="flex flex-col">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            <span className="chip text-white" style={{ background: project?.color }}>{project?.key}-{task.number}</span>
            <span className="truncate text-xs muted">{project?.name}</span>
            <div className="ml-auto flex items-center gap-1">
              {timerHere ? (
                <button className="btn bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => run("timer", async () => void (await stop(), reload()))}>
                  <Square size={14} fill="currentColor" /> Stop
                </button>
              ) : (
                <button className="btn-outline" onClick={() => run("timer", () => start({ task: task._id }))}>
                  <Play size={14} /> Start timer
                </button>
              )}
              {(can("admin", "manager") || task.reporter?._id === user?._id) && (
                <button
                  className="btn-ghost p-2 text-rose-600"
                  title="Delete task"
                  onClick={() => {
                    if (!confirm("Delete this task? Its comments are removed and logged time is kept.")) return;
                    void run("del", async () => {
                      await del(`/tasks/${task._id}`);
                      onChanged?.({ _id: task._id, deleted: true });
                      onClose();
                    });
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button className="btn-ghost p-2" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="space-y-6 p-5">
            <input className="w-full bg-transparent text-xl font-semibold outline-none" defaultValue={task.title} key={`t-${task._id}-${task.title}`} onBlur={(e) => e.target.value.trim() && e.target.value !== task.title && update({ title: e.target.value.trim() })} />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Status">
                <select className="input" value={task.status} onChange={(e) => update({ status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className="input" value={task.priority} onChange={(e) => update({ priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Assignee">
                <select className="input" value={task.assignee?._id ?? ""} onChange={(e) => update({ assignee: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {users?.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Due date">
                <input className="input" type="date" value={task.dueDate ? isoDate(new Date(task.dueDate)) : ""} onChange={(e) => update({ dueDate: e.target.value || null })} />
              </Field>
              <Field label="Estimate (h)">
                <input className="input" type="number" min="0" step="0.5" defaultValue={task.estimateHours ?? ""} key={`e-${task.estimateHours}`} onBlur={(e) => update({ estimateHours: e.target.value ? Number(e.target.value) : null })} />
              </Field>
              <Field label="Logged">
                <div className="flex h-[38px] items-center gap-2 text-sm">
                  <Clock size={14} className="muted" /> {fmtHours(task.timeEntries.reduce((a, t) => a + t.minutes, 0))}
                  {task.estimateHours ? <span className="muted">/ {task.estimateHours}h</span> : null}
                </div>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {task.labels.map((l) => (
                <span key={l} className="group">
                  <Label>
                    {l}
                    <button className="opacity-50 hover:opacity-100" onClick={() => update({ labels: task.labels.filter((x) => x !== l) })}><X size={10} /></button>
                  </Label>
                </span>
              ))}
              <input className="w-28 rounded border border-dashed border-slate-300 bg-transparent px-2 py-0.5 text-xs outline-none dark:border-slate-700" placeholder="+ label" value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter" && labelDraft.trim()) {
                  update({ labels: [...new Set([...task.labels, labelDraft.trim().toLowerCase()])] });
                  setLabelDraft("");
                }
              }} />
            </div>

            <Field label="Description">
              <textarea className="input min-h-24" defaultValue={task.description ?? ""} key={`d-${task._id}`} placeholder="Add more detail…" onBlur={(e) => e.target.value !== (task.description ?? "") && update({ description: e.target.value })} />
            </Field>

            {/* AI assist */}
            <div className="card-ai p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300"><Sparkles size={14} /> AI assist</div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ai btn-sm" disabled={!!busy} onClick={() => run("bd", async () => setSuggest(await post(`/ai/breakdown`, { task: task._id })))}>
                  {busy === "bd" ? <Spinner /> : <ListChecks size={14} />} Break into subtasks
                </button>
                <button className="btn-ai btn-sm" disabled={!!busy} onClick={() => run("est", async () => setEstimate(await post(`/ai/estimate`, { task: task._id })))}>
                  {busy === "est" ? <Spinner /> : <Calculator size={14} />} Estimate effort
                </button>
              </div>
              {suggest && (
                <div className="mt-3 space-y-1.5">
                  {suggest.subtasks.map((s) => <div key={s} className="flex items-center gap-2 text-sm"><Plus size={13} className="text-violet-500" />{s}</div>)}
                  <div className="flex gap-2 pt-1">
                    <button className="btn-primary btn-sm" onClick={() => run("addsub", async () => { apply(await post<Task>(`/tasks/${task._id}/subtasks`, { titles: suggest.subtasks })); setSuggest(null); })}>Add all {suggest.subtasks.length}</button>
                    <button className="btn-ghost btn-sm" onClick={() => setSuggest(null)}>Dismiss</button>
                    <span className="ml-auto self-center text-[11px] muted">{suggest.mode === "live" ? "Claude" : "demo heuristic"}</span>
                  </div>
                </div>
              )}
              {estimate && (
                <div className="mt-3 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold">{estimate.hours}h</span>
                    <span className="muted">range {estimate.low}–{estimate.high}h · {estimate.confidence} confidence</span>
                  </div>
                  <p className="mt-1 muted">{estimate.rationale}</p>
                  <div className="flex gap-2 pt-2">
                    <button className="btn-primary btn-sm" onClick={() => { void update({ estimateHours: estimate.hours }); setEstimate(null); }}>Set estimate</button>
                    <button className="btn-ghost btn-sm" onClick={() => setEstimate(null)}>Dismiss</button>
                    <span className="ml-auto self-center text-[11px] muted">{estimate.mode === "live" ? "Claude" : "demo heuristic"}</span>
                  </div>
                </div>
              )}
            </div>

            {/* subtasks */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <CheckSquare size={15} className="muted" /><span className="section-title">Checklist</span>
                {task.subtasks.length > 0 && <span className="text-xs muted">{subDone}/{task.subtasks.length}</span>}
              </div>
              {task.subtasks.length > 0 && <div className="mb-2"><Progress value={(subDone / task.subtasks.length) * 100} color="#10b981" /></div>}
              <div className="space-y-1">
                {task.subtasks.map((s) => (
                  <div key={s._id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={s.done} onChange={() => run("sub", async () => apply(await patch<Task>(`/tasks/${task._id}/subtasks/${s._id}`, { done: !s.done })))} />
                    <span className={`flex-1 text-sm ${s.done ? "line-through muted" : ""}`}>{s.title}</span>
                    <button className="opacity-0 group-hover:opacity-100 muted hover:text-rose-600" onClick={() => run("sub", async () => apply(await api<Task>(`/tasks/${task._id}/subtasks/${s._id}`, { method: "DELETE" })))}><X size={14} /></button>
                  </div>
                ))}
              </div>
              <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newSub.trim()) return; void run("sub", async () => { apply(await post<Task>(`/tasks/${task._id}/subtasks`, { titles: [newSub.trim()] })); setNewSub(""); }); }}>
                <input className="input" placeholder="Add an item…" value={newSub} onChange={(e) => setNewSub(e.target.value)} />
                <button className="btn-outline" disabled={!newSub.trim()}><Plus size={14} /></button>
              </form>
            </section>

            {/* attachments (metadata only) */}
            <section>
              <div className="mb-2 flex items-center gap-2"><Paperclip size={15} className="muted" /><span className="section-title">Attachments</span></div>
              <div className="space-y-1">
                {task.attachments.map((a) => (
                  <div key={a._id} className="group flex items-center gap-2 rounded border border-slate-100 px-2 py-1.5 text-sm dark:border-slate-800">
                    <Paperclip size={13} className="muted" />
                    {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-indigo-600 hover:underline">{a.name}</a> : <span className="truncate">{a.name}</span>}
                    {a.size ? <span className="text-xs muted">{(a.size / 1_000_000).toFixed(1)} MB</span> : null}
                    <button className="ml-auto opacity-0 group-hover:opacity-100 muted hover:text-rose-600" onClick={() => run("att", async () => { await del(`/tasks/${task._id}/attachments/${a._id}`); await reload(); })}><X size={14} /></button>
                  </div>
                ))}
              </div>
              <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run("att", async () => { apply(await post<Task>(`/tasks/${task._id}/attachments`, { name: att.name, url: att.url || undefined })); setAtt({ name: "", url: "" }); }); }}>
                <input className="input" placeholder="File name" required value={att.name} onChange={(e) => setAtt({ ...att, name: e.target.value })} />
                <input className="input" placeholder="Link (Drive, Figma…)" type="url" value={att.url} onChange={(e) => setAtt({ ...att, url: e.target.value })} />
                <button className="btn-outline" disabled={!att.name}><Plus size={14} /></button>
              </form>
            </section>

            {/* time */}
            <section>
              <div className="mb-2 flex items-center gap-2"><Clock size={15} className="muted" /><span className="section-title">Time</span></div>
              <form className="mb-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void run("time", async () => { await post<TimeEntry>("/time", { task: task._id, date: manual.date, minutes: Number(manual.minutes), description: manual.description || undefined }); setManual({ ...manual, description: "" }); toast("Time logged"); await reload(); }); }}>
                <input className="input w-36" type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
                <select className="input w-24" value={manual.minutes} onChange={(e) => setManual({ ...manual, minutes: e.target.value })}>
                  {[15, 30, 45, 60, 90, 120, 180, 240, 480].map((m) => <option key={m} value={m}>{fmtHours(m)}</option>)}
                </select>
                <input className="input min-w-32 flex-1" placeholder="What did you do?" value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
                <button className="btn-outline">Log time</button>
              </form>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {task.timeEntries.slice(0, 8).map((t) => (
                  <div key={t._id} className="flex items-center gap-2 py-1.5 text-sm">
                    <Avatar user={t.user} size={20} />
                    <span className="truncate">{t.description ?? (t.source === "timer" ? "Timer" : "Manual entry")}</span>
                    {!t.billable && <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800">non-billable</span>}
                    <span className="ml-auto text-xs muted">{fmtDate(t.startedAt)}</span>
                    <span className="w-14 text-right font-medium tabular-nums">{t.endedAt ? fmtHours(t.minutes) : "running"}</span>
                  </div>
                ))}
                {!task.timeEntries.length && <div className="py-2 text-sm muted">No time logged yet.</div>}
              </div>
            </section>

            {/* comments */}
            <section>
              <div className="mb-3 flex items-center gap-2"><MessageSquare size={15} className="muted" /><span className="section-title">Comments</span></div>
              <div className="space-y-3">
                {task.comments.map((c) => (
                  <div key={c._id} className="flex gap-2.5">
                    <Avatar user={c.author} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs"><span className="font-semibold">{c.author.name}</span> <span className="muted">{timeAgo(c.createdAt)}</span></div>
                      <div className="mt-0.5 text-sm whitespace-pre-wrap">{c.body.split(/(@\w+)/g).map((part, i) => (part.startsWith("@") ? <span key={i} className="font-medium text-indigo-600 dark:text-indigo-400">{part}</span> : part))}</div>
                    </div>
                  </div>
                ))}
              </div>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!comment.trim()) return; void run("c", async () => { const c = await post<Comment>(`/tasks/${task._id}/comments`, { body: comment }); setTask((cur) => (cur && !cur.comments.some((x) => x._id === c._id) ? { ...cur, comments: [...cur.comments, c] } : cur)); setComment(""); }); }}>
                <Avatar user={user} size={28} />
                <input className="input" placeholder="Write a comment… use @name to mention" value={comment} onChange={(e) => setComment(e.target.value)} />
                <button className="btn-primary" disabled={!comment.trim() || busy === "c"}>Send</button>
              </form>
            </section>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
