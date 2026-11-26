import { useState } from "react";
import { Plus, Shield } from "lucide-react";
import { patch, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtMoney } from "../lib/format";
import { useApi } from "../lib/hooks";
import type { Role, User } from "../lib/types";
import { Avatar, ErrorBox, Modal, PageLoader, toast } from "../components/ui";

const ROLE_CLS: Record<Role, string> = {
  admin: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  manager: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  member: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export function TeamPage() {
  const { user, can } = useAuth();
  const { data, error, reload } = useApi<User[]>("/users");
  const [adding, setAdding] = useState(false);
  const isAdmin = can("admin");

  const update = async (u: User, body: Partial<User>) => {
    try {
      await patch(`/users/${u._id}`, body);
      toast("Saved");
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Team</h1>
        {isAdmin && <button className="btn-primary ml-auto" onClick={() => setAdding(true)}><Plus size={16} /> Add teammate</button>}
      </div>
      <div className="card flex items-start gap-2 p-3 text-xs muted">
        <Shield size={14} className="mt-0.5 shrink-0" />
        <span><b>Admins</b> manage the workspace, people, rates and billing. <b>Managers</b> run clients and projects, see everyone's time and invoices. <b>Members</b> work on tasks and track their own time.</span>
      </div>
      {!data ? <PageLoader /> : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {data.map((u) => (
            <div key={u._id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${u.active === false ? "opacity-50" : ""}`}>
              <Avatar user={u} size={36} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{u.name}{u._id === user?._id && <span className="ml-1 text-xs muted">(you)</span>}</div>
                <div className="truncate text-xs muted">{u.title ? `${u.title} · ` : ""}{u.email}</div>
              </div>
              <div className="text-xs muted">{u.weeklyCapacity ?? 40}h/wk{u.hourlyRate && can("admin", "manager") ? ` · ${fmtMoney(u.hourlyRate)}/h` : ""}</div>
              {isAdmin && u._id !== user?._id ? (
                <>
                  <select className="input w-28" value={u.role} onChange={(e) => update(u, { role: e.target.value as Role })}>
                    <option value="admin">admin</option><option value="manager">manager</option><option value="member">member</option>
                  </select>
                  <button className="btn-ghost btn-sm" onClick={() => update(u, { active: u.active === false })}>{u.active === false ? "Reactivate" : "Deactivate"}</button>
                </>
              ) : (
                <span className={`chip capitalize ${ROLE_CLS[u.role]}`}>{u.role}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {adding && <AddUser onClose={() => setAdding(false)} onSaved={() => (setAdding(false), reload())} />}
    </div>
  );
}

function AddUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", email: "", password: "", role: "member" as Role, title: "", hourlyRate: "", weeklyCapacity: "40" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post("/users", { ...f, title: f.title || undefined, hourlyRate: f.hourlyRate ? Number(f.hourlyRate) : undefined, weeklyCapacity: Number(f.weeklyCapacity) });
      toast(`${f.name} added — share their temporary password with them`);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  return (
    <Modal open onClose={onClose} title="Add teammate" wide>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <div><label className="label">Name</label><input className="input" required value={f.name} onChange={set("name")} autoFocus /></div>
        <div><label className="label">Email</label><input className="input" type="email" required value={f.email} onChange={set("email")} /></div>
        <div><label className="label">Temporary password</label><input className="input" type="text" required minLength={8} value={f.password} onChange={set("password")} autoComplete="new-password" /></div>
        <div><label className="label">Role</label><select className="input" value={f.role} onChange={set("role")}><option>member</option><option>manager</option><option>admin</option></select></div>
        <div><label className="label">Job title</label><input className="input" value={f.title} onChange={set("title")} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Rate ($/h)</label><input className="input" type="number" min="0" value={f.hourlyRate} onChange={set("hourlyRate")} /></div>
          <div><label className="label">Hours/week</label><input className="input" type="number" min="1" max="80" value={f.weeklyCapacity} onChange={set("weeklyCapacity")} /></div>
        </div>
        <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Add</button></div>
      </form>
    </Modal>
  );
}
