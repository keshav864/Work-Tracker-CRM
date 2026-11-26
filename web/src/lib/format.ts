export const fmtHours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};

export const fmtClock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export const fmtDate = (d?: string | null, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  d ? new Date(d).toLocaleDateString(undefined, opts) : "";

export const fmtMoney = (n: number, currency = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);

export function timeAgo(d: string) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
}

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function startOfWeek(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function dueState(due?: string | null, status?: string): "overdue" | "soon" | "ok" | null {
  if (!due) return null;
  if (status === "done") return "ok";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  if (d < today) return "overdue";
  if (d.getTime() - today.getTime() < 3 * 86400_000) return "soon";
  return "ok";
}

export const projectOf = (t: { project: unknown }) => (typeof t.project === "object" && t.project ? (t.project as { _id: string; key: string; name: string; color: string }) : null);
export const taskRef = (t: { number: number; project: unknown }, key?: string) => `${key ?? projectOf(t)?.key ?? "#"}-${t.number}`;
