import { useEffect, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { post } from "../lib/api";
import { useApi } from "../lib/hooks";
import { PRIORITIES, STATUSES, type Priority, type Project, type Status, type Task, type User } from "../lib/types";
import { Modal, Spinner, toast } from "./ui";

interface Draft {
  title: string;
  description?: string;
  priority: Priority;
  dueDate?: string;
  estimateHours?: number;
  labels: string[];
  assigneeId?: string;
  projectId?: string;
  mode: "live" | "demo";
  warning?: string;
}

const EXAMPLES = ["Urgent: fix checkout bug for Diego by Friday #payments ~3h", "Sam to draft onboarding screens next week in Mobile App MVP", "Prepare UAT notes for Acme tomorrow, high priority"];

/** Create a task — optionally by describing it in plain English and letting AI fill the form. */
export function NewTaskModal({ open, onClose, defaultProject, defaultStatus, onCreated }: { open: boolean; onClose: () => void; defaultProject?: string; defaultStatus?: Status; onCreated?: (t: Task) => void }) {
  const { data: projects } = useApi<Project[]>(open ? "/projects" : null);
  const { data: users } = useApi<User[]>(open ? "/users" : null);
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", description: "", project: defaultProject ?? "", assignee: "", priority: "medium" as Priority, status: defaultStatus ?? ("todo" as Status), dueDate: "", estimateHours: "", labels: "" });

  useEffect(() => {
    if (open) {
      setText("");
      setAiNote(null);
      setF((x) => ({ ...x, title: "", description: "", assignee: "", priority: "medium", dueDate: "", estimateHours: "", labels: "", project: defaultProject ?? x.project, status: defaultStatus ?? "todo" }));
    }
  }, [open, defaultProject, defaultStatus]);
  useEffect(() => {
    if (!f.project && projects?.length) setF((x) => ({ ...x, project: projects[0]._id }));
  }, [projects, f.project]);

  const parse = async () => {
    if (text.trim().length < 3) return;
    setParsing(true);
    try {
      const d = await post<Draft>("/ai/parse-task", { text, project: f.project || undefined });
      setF((x) => ({
        ...x,
        title: d.title,
        description: d.description ?? x.description,
        priority: d.priority,
        dueDate: d.dueDate ?? "",
        estimateHours: d.estimateHours ? String(d.estimateHours) : "",
        labels: d.labels.join(", "),
        assignee: d.assigneeId ?? x.assignee,
        project: d.projectId ?? x.project,
      }));
      setAiNote(d.mode === "live" ? "Filled by Claude — review and create." : `Filled by the offline parser (demo mode)${d.warning ? ` — ${d.warning}` : ""}. Review and create.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setParsing(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const t = await post<Task>("/tasks", {
        project: f.project,
        title: f.title,
        description: f.description || undefined,
        priority: f.priority,
        status: f.status,
        assignee: f.assignee || null,
        dueDate: f.dueDate || null,
        estimateHours: f.estimateHours ? Number(f.estimateHours) : null,
        labels: f.labels.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      });
      toast(`Created ${typeof t.project === "object" ? t.project.key : ""}-${t.number}`);
      onCreated?.(t);
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <Modal open={open} onClose={onClose} title="New task" wide>
      <div className="card-ai mb-4 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
          <Sparkles size={14} /> Describe it in plain English
        </div>
        <div className="flex gap-2">
          <input className="input" placeholder={EXAMPLES[0]} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), parse())} autoFocus />
          <button type="button" className="btn-ai" onClick={parse} disabled={parsing || text.trim().length < 3}>
            {parsing ? <Spinner /> : <Wand2 size={16} />} Fill
          </button>
        </div>
        {aiNote ? (
          <div className="mt-2 text-xs text-violet-700 dark:text-violet-300">{aiNote}</div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1">
            {EXAMPLES.slice(1).map((ex) => (
              <button key={ex} type="button" className="chip cursor-pointer bg-white/70 text-slate-600 hover:bg-white dark:bg-slate-800 dark:text-slate-300" onClick={() => setText(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Title</label>
          <input className="input" required value={f.title} onChange={set("title")} />
        </div>
        <div className="col-span-2">
          <label className="label">Description</label>
          <textarea className="input min-h-16" value={f.description} onChange={set("description")} />
        </div>
        <div>
          <label className="label">Project</label>
          <select className="input" required value={f.project} onChange={set("project")}>
            {projects?.map((p) => (
              <option key={p._id} value={p._id}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Assignee</label>
          <select className="input" value={f.assignee} onChange={set("assignee")}>
            <option value="">Unassigned</option>
            {users?.filter((u) => u.active !== false).map((u) => (
              <option key={u._id} value={u._id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={f.status} onChange={set("status")}>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Priority</label>
          <select className="input" value={f.priority} onChange={set("priority")}>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Due date</label>
          <input className="input" type="date" value={f.dueDate} onChange={set("dueDate")} />
        </div>
        <div>
          <label className="label">Estimate (hours)</label>
          <input className="input" type="number" min="0" step="0.5" value={f.estimateHours} onChange={set("estimateHours")} />
        </div>
        <div className="col-span-2">
          <label className="label">Labels (comma separated)</label>
          <input className="input" value={f.labels} onChange={set("labels")} placeholder="frontend, bug" />
        </div>
        <div className="col-span-2 mt-1 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving || !f.title || !f.project}>
            {saving && <Spinner />} Create task
          </button>
        </div>
      </form>
    </Modal>
  );
}
