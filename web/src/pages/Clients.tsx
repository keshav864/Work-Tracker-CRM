import { useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, Plus, Search } from "lucide-react";
import { patch, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import type { ClientT } from "../lib/types";
import { Avatar, Empty, ErrorBox, Modal, PageLoader, toast } from "../components/ui";

export const CLIENT_STATUS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  lead: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  churned: "bg-slate-100 text-slate-500 dark:bg-slate-800",
};

export function ClientsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const { data, error, reload } = useApi<ClientT[]>(`/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const [creating, setCreating] = useState(false);
  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Clients</h1>
        <div className="relative ml-auto">
          <Search size={14} className="absolute top-2.5 left-2.5 muted" />
          <input className="input w-56 pl-8" placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {can("admin", "manager") && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New client</button>}
      </div>
      {!data ? <PageLoader /> : !data.length ? (
        <div className="card"><Empty icon={<Briefcase size={36} />} title="No clients yet" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs muted dark:border-slate-800">
              <tr><th className="px-4 py-2.5 font-medium">Client</th><th className="px-4 font-medium">Status</th><th className="px-4 font-medium">Projects</th><th className="px-4 font-medium">Contacts</th><th className="px-4 text-right font-medium">Hours (billable)</th><th className="px-4 font-medium">Owner</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((c) => (
                <tr key={c._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3"><Link to={`/clients/${c._id}`} className="font-medium hover:text-indigo-600">{c.name}</Link><div className="text-xs muted">{c.industry}</div></td>
                  <td className="px-4"><span className={`chip capitalize ${CLIENT_STATUS[c.status]}`}>{c.status}</span></td>
                  <td className="px-4 tabular-nums">{c.activeProjects} active <span className="muted">/ {c.projectCount}</span></td>
                  <td className="px-4 tabular-nums">{c.contactCount}</td>
                  <td className="px-4 text-right tabular-nums">{c.hours}h <span className="muted">({c.billableHours}h)</span></td>
                  <td className="px-4"><Avatar user={c.owner} size={24} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <ClientModal onClose={() => setCreating(false)} onSaved={() => (setCreating(false), reload())} />}
    </div>
  );
}

export function ClientModal({ client, onClose, onSaved }: { client?: ClientT; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: client?.name ?? "", industry: client?.industry ?? "", website: client?.website ?? "", status: client?.status ?? "active", hourlyRate: client?.hourlyRate?.toString() ?? "", notes: client?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, hourlyRate: f.hourlyRate ? Number(f.hourlyRate) : null };
      if (client) await patch(`/clients/${client._id}`, body);
      else await post("/clients", body);
      toast(client ? "Client saved" : "Client created");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={client ? "Edit client" : "New client"} wide>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1"><label className="label">Name</label><input className="input" required value={f.name} onChange={set("name")} autoFocus /></div>
        <div className="col-span-2 sm:col-span-1"><label className="label">Industry</label><input className="input" value={f.industry} onChange={set("industry")} /></div>
        <div><label className="label">Website</label><input className="input" value={f.website} onChange={set("website")} placeholder="https://" /></div>
        <div><label className="label">Status</label><select className="input" value={f.status} onChange={set("status")}>{["lead", "active", "paused", "churned"].map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label className="label">Hourly rate</label><input className="input" type="number" min="0" value={f.hourlyRate} onChange={set("hourlyRate")} placeholder="Workspace default" /></div>
        <div className="col-span-2"><label className="label">Notes</label><textarea className="input" value={f.notes} onChange={set("notes")} /></div>
        <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
