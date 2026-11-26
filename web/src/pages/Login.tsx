import { useState } from "react";
import { CheckCircle2, Clock, KanbanSquare, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ErrorBox, Spinner } from "../components/ui";

const DEMO = { email: "demo@worktracker.dev", password: "demo1234" };

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ name: "", email: "", password: "", organization: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent, creds?: typeof DEMO) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (creds) await login(creds.email, creds.password);
      else if (mode === "login") await login(f.email, f.password);
      else await register(f);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <img src="/favicon.svg" className="h-8 w-8 rounded-lg ring-2 ring-white/30" alt="" /> Work Tracker CRM
        </div>
        <div className="space-y-6">
          <h1 className="text-4xl leading-tight font-semibold">Client work, tracked end to end.</h1>
          <ul className="space-y-3 text-white/90">
            <li className="flex gap-3"><KanbanSquare className="shrink-0" /> Kanban boards per project with real-time updates</li>
            <li className="flex gap-3"><Clock className="shrink-0" /> One-click timers, weekly timesheets and invoice summaries</li>
            <li className="flex gap-3"><Sparkles className="shrink-0" /> AI task creation, breakdowns, estimates and status reports</li>
            <li className="flex gap-3"><CheckCircle2 className="shrink-0" /> Workload, overdue work and project health at a glance</li>
          </ul>
        </div>
        <div className="text-sm text-white/60">MongoDB · Express · React · Node.js · Claude</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h2 className="text-2xl font-semibold">{mode === "login" ? "Welcome back" : "Create your workspace"}</h2>
            <p className="mt-1 text-sm muted">{mode === "login" ? "Sign in to your team's workspace." : "You'll be the admin and can invite your team."}</p>
          </div>
          <button className="btn-ai w-full py-2.5" onClick={() => submit(undefined, DEMO)} disabled={busy}>
            {busy ? <Spinner /> : <Sparkles size={16} />} Explore the demo workspace
          </button>
          <div className="flex items-center gap-3 text-xs muted">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /> or <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>
          <form onSubmit={submit} className="space-y-3">
            {mode === "register" && (
              <>
                <div><label className="label">Your name</label><input className="input" required minLength={2} value={f.name} onChange={set("name")} /></div>
                <div><label className="label">Company / workspace</label><input className="input" required minLength={2} value={f.organization} onChange={set("organization")} /></div>
              </>
            )}
            <div><label className="label">Email</label><input className="input" type="email" required autoComplete="email" value={f.email} onChange={set("email")} /></div>
            <div><label className="label">Password</label><input className="input" type="password" required minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} value={f.password} onChange={set("password")} /></div>
            {err && <ErrorBox error={err} />}
            <button className="btn-primary w-full py-2.5" disabled={busy}>{mode === "login" ? "Sign in" : "Create workspace"}</button>
          </form>
          <p className="text-center text-sm muted">
            {mode === "login" ? "New here? " : "Already have an account? "}
            <button className="font-medium text-indigo-600 hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Create a workspace" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
