import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, Mail, Pencil, Phone, Plus, Receipt, Star, Trash2 } from "lucide-react";
import { del, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { addDays, fmtMoney, isoDate } from "../lib/format";
import { useApi } from "../lib/hooks";
import type { ClientT, Contact, Project } from "../lib/types";
import { Empty, ErrorBox, Modal, PageLoader, toast } from "../components/ui";
import { ClientModal, CLIENT_STATUS } from "./Clients";
import { NewProjectModal } from "./Projects";

interface Invoice {
  client: { name: string };
  currency: string;
  from: string;
  to: string;
  lines: { project: string; projectKey: string; person: string; rate: number; billableHours: number; amount: number; nonBillableMinutes: number }[];
  billableHours: number;
  nonBillableHours: number;
  subtotal: number;
}

export function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: client, error, reload } = useApi<ClientT & { contacts: Contact[]; projects: Project[] }>(`/clients/${id}`);
  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const now = new Date();
  const [range, setRange] = useState({ from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) });
  const { data: invoice } = useApi<Invoice>(can("admin", "manager") ? `/time/invoice?client=${id}&from=${range.from}&to=${range.to}` : null);

  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!client) return <PageLoader />;

  const presets = [
    { label: "This month", from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) },
    { label: "Last month", from: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)) },
    { label: "Last 30 days", from: isoDate(addDays(now, -30)), to: isoDate(now) },
  ];

  const exportCsv = () => {
    if (!invoice) return;
    const rows = [["Project", "Person", "Billable hours", "Rate", "Amount"], ...invoice.lines.map((l) => [`${l.projectKey} ${l.project}`, l.person, l.billableHours, l.rate, l.amount]), ["", "", invoice.billableHours, "", invoice.subtotal]];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `invoice-${client.name.replace(/\W+/g, "-").toLowerCase()}-${range.from}-to-${range.to}.csv`;
    a.click();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <Link to="/clients" className="btn-ghost mt-0.5 p-1.5"><ArrowLeft size={16} /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{client.name}</h1>
            <span className={`chip capitalize ${CLIENT_STATUS[client.status]}`}>{client.status}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm muted">
            {client.industry && <span>{client.industry}</span>}
            {client.website && <a href={client.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">{client.website.replace(/^https?:\/\//, "")} <ExternalLink size={12} /></a>}
            {client.hourlyRate ? <span>{fmtMoney(client.hourlyRate)}/h</span> : null}
          </div>
        </div>
        {can("admin", "manager") && <button className="btn-outline" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
      </div>
      {client.notes && <div className="card p-3 text-sm"><span className="font-medium">Notes: </span><span className="muted">{client.notes}</span></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Contacts</h2>
            {can("admin", "manager") && <button className="btn-ghost btn-sm" onClick={() => setAddingContact(true)}><Plus size={14} /> Add</button>}
          </div>
          <div className="space-y-3">
            {client.contacts.map((c) => (
              <div key={c._id} className="group flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold dark:bg-slate-800">{c.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex items-center gap-1 font-medium">{c.name}{c.isPrimary && <Star size={12} className="fill-amber-400 text-amber-400" />}</div>
                  {c.title && <div className="text-xs muted">{c.title}</div>}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-indigo-600 hover:underline"><Mail size={11} /> {c.email}</a>}
                    {c.phone && <span className="inline-flex items-center gap-1 muted"><Phone size={11} /> {c.phone}</span>}
                  </div>
                </div>
                {can("admin", "manager") && <button className="opacity-0 group-hover:opacity-100 muted hover:text-rose-600" onClick={async () => { if (confirm(`Remove ${c.name}?`)) { await del(`/clients/contacts/${c._id}`); void reload(); } }}><Trash2 size={14} /></button>}
              </div>
            ))}
            {!client.contacts.length && <div className="text-sm muted">No contacts yet.</div>}
          </div>
        </div>

        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Projects</h2>
            {can("admin", "manager") && <button className="btn-ghost btn-sm" onClick={() => setNewProject(true)}><Plus size={14} /> New project</button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {client.projects.map((p) => (
              <Link key={p._id} to={`/projects/${p._id}`} className="rounded-lg border border-slate-100 p-3 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-600">
                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} /><span className="text-sm font-medium">{p.name}</span><span className="ml-auto text-xs capitalize muted">{p.status.replace("_", " ")}</span></div>
                {p.description && <p className="mt-1 line-clamp-2 text-xs muted">{p.description}</p>}
              </Link>
            ))}
            {!client.projects.length && <Empty title="No projects for this client" />}
          </div>
        </div>
      </div>

      {can("admin", "manager") && (
        <div className="card p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Receipt size={16} className="muted" />
            <h2 className="section-title">Invoice summary</h2>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {presets.map((p) => <button key={p.label} className={`btn-sm btn ${range.from === p.from && range.to === p.to ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "btn-ghost"}`} onClick={() => setRange({ from: p.from, to: p.to })}>{p.label}</button>)}
              <input type="date" className="input w-36" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <span className="muted">–</span>
              <input type="date" className="input w-36" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              <button className="btn-outline" onClick={exportCsv} disabled={!invoice?.lines.length}><Download size={14} /> CSV</button>
            </div>
          </div>
          {!invoice ? <PageLoader /> : invoice.lines.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs muted"><tr><th className="py-2 font-medium">Project</th><th className="font-medium">Person</th><th className="text-right font-medium">Hours</th><th className="text-right font-medium">Rate</th><th className="text-right font-medium">Amount</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {invoice.lines.map((l, i) => (
                    <tr key={i}><td className="py-2"><span className="mr-2 font-mono text-xs muted">{l.projectKey}</span>{l.project}</td><td>{l.person}</td><td className="text-right tabular-nums">{l.billableHours.toFixed(2)}</td><td className="text-right tabular-nums">{fmtMoney(l.rate, invoice.currency)}</td><td className="text-right font-medium tabular-nums">{fmtMoney(l.amount, invoice.currency)}</td></tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 dark:border-slate-700">
                  <tr><td className="pt-3 font-semibold" colSpan={2}>Total billable</td><td className="pt-3 text-right font-semibold tabular-nums">{invoice.billableHours}h</td><td /><td className="pt-3 text-right text-lg font-semibold tabular-nums">{fmtMoney(invoice.subtotal, invoice.currency)}</td></tr>
                  <tr><td colSpan={5} className="pt-1 text-xs muted">{invoice.nonBillableHours}h non-billable time not included · rates: project → client → person → workspace default</td></tr>
                </tfoot>
              </table>
            </div>
          ) : <Empty title="No billable time in this period" />}
        </div>
      )}

      {editing && <ClientModal client={client} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), reload())} />}
      {addingContact && <ContactModal clientId={client._id} onClose={() => setAddingContact(false)} onSaved={() => (setAddingContact(false), reload())} />}
      {newProject && <NewProjectModal defaultClient={client._id} onClose={() => setNewProject(false)} />}
    </div>
  );
}

function ContactModal({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", title: "", isPrimary: false });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post(`/clients/${clientId}/contacts`, f);
      toast("Contact added");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  return (
    <Modal open onClose={onClose} title="Add contact">
      <form onSubmit={save} className="space-y-3">
        <div><label className="label">Name</label><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></div>
        <div><label className="label">Title</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label">Phone</label><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-600" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Primary contact</label>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Add</button></div>
      </form>
    </Modal>
  );
}
