import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUp, Loader2, Minus, X } from "lucide-react";
import type { Priority, Status, UserLite } from "../lib/types";
import { STATUSES } from "../lib/types";

export function Avatar({ user, size = 28 }: { user?: UserLite | null; size?: number }) {
  if (!user || typeof user !== "object" || !user.name) return <span className="inline-flex items-center justify-center rounded-full border border-dashed border-slate-300 text-[10px] text-slate-400 dark:border-slate-600" style={{ width: size, height: size }}>?</span>;
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span title={user.name} className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-slate-900" style={{ width: size, height: size, background: user.avatarColor ?? "#6366f1", fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}

const PRIORITY_STYLE: Record<Priority, { cls: string; icon: ReactNode }> = {
  urgent: { cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300", icon: <ChevronsUp size={12} /> },
  high: { cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300", icon: <ArrowUp size={12} /> },
  medium: { cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300", icon: <Minus size={12} /> },
  low: { cls: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300", icon: <ArrowDown size={12} /> },
};
export function PriorityBadge({ p }: { p: Priority }) {
  const s = PRIORITY_STYLE[p];
  return <span className={`chip ${s.cls}`}>{s.icon}{p}</span>;
}

export function StatusBadge({ s }: { s: Status }) {
  const st = STATUSES.find((x) => x.id === s)!;
  return (
    <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
      {st.label}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{children}</span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={16} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center muted">
      <Spinner />
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <AlertTriangle size={16} /> {error}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {icon && <div className="text-slate-300 dark:text-slate-600">{icon}</div>}
      <div className="section-title">{title}</div>
      {children && <div className="text-sm muted">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className={`card w-full ${wide ? "max-w-2xl" : "max-w-md"} p-5`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost p-1" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-[1px]" onMouseDown={onClose}>
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </aside>
    </div>
  );
}

export function Progress({ value, color = "#6366f1" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = "slate" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "slate" | "rose" | "emerald" | "indigo" | "amber" }) {
  const tones = { slate: "text-slate-500 bg-slate-100 dark:bg-slate-800", rose: "text-rose-600 bg-rose-50 dark:bg-rose-500/10", emerald: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10", indigo: "text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10", amber: "text-amber-600 bg-amber-50 dark:bg-amber-500/10" };
  return (
    <div className="card flex items-center gap-3 p-4">
      {icon && <div className={`rounded-lg p-2 ${tones[tone]}`}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-xs muted">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="truncate text-xs muted">{sub}</div>}
      </div>
    </div>
  );
}

/* ----------------------------- tiny toast system ----------------------------- */
type ToastT = { id: number; text: string; tone: "ok" | "error" };
let push: ((t: ToastT) => void) | null = null;
let nextId = 1;
export const toast = (text: string, tone: "ok" | "error" = "ok") => push?.({ id: nextId++, text, tone });

export function Toaster() {
  const [items, setItems] = useState<ToastT[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 3500);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div key={t.id} className={`pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-lg ${t.tone === "error" ? "bg-rose-600 text-white" : "bg-slate-900 text-white dark:bg-white dark:text-slate-900"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
