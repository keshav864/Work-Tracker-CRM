import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Bell, Briefcase, CheckSquare, Clock, FolderKanban, LayoutDashboard, LogOut, Menu, Moon, Plus, Sparkles, Square, Sun, Users, X } from "lucide-react";
import { get, post } from "../lib/api";
import { useAuth, useSocketEvent } from "../lib/auth";
import { fmtClock, timeAgo } from "../lib/format";
import { useApi, useTheme, useTick } from "../lib/hooks";
import { useTimer } from "../lib/timer";
import type { Notification } from "../lib/types";
import { NewTaskModal } from "./NewTaskModal";
import { Avatar, toast } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/my-tasks", label: "My tasks", icon: CheckSquare },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/clients", label: "Clients", icon: Briefcase },
  { to: "/time", label: "Time", icon: Clock },
  { to: "/team", label: "Team", icon: Users },
];

function TimerPill() {
  const { running, stop } = useTimer();
  useTick(!!running);
  if (!running) return null;
  const secs = (Date.now() - new Date(running.startedAt).getTime()) / 1000;
  return (
    <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 py-1 pr-1 pl-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
      <span className="hidden max-w-40 truncate text-emerald-800 sm:inline dark:text-emerald-200">{running.task?.title ?? running.project?.name}</span>
      <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-300">{fmtClock(secs)}</span>
      <button className="rounded-full bg-emerald-600 p-1.5 text-white hover:bg-emerald-500" onClick={() => stop().catch((e) => toast(e.message, "error"))} title="Stop timer">
        <Square size={12} fill="currentColor" />
      </button>
    </div>
  );
}

function Notifications() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { data, setData, reload } = useApi<{ items: Notification[]; unread: number }>("/notifications");
  const ref = useRef<HTMLDivElement>(null);
  useSocketEvent<Notification>(
    "notification",
    useCallback(
      (n) => {
        setData((d) => ({ items: [n, ...(d?.items ?? [])], unread: (d?.unread ?? 0) + 1 }));
        toast(n.title);
      },
      [setData],
    ),
  );
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const openItem = async (n: Notification) => {
    setOpen(false);
    if (!n.read) await post(`/notifications/${n._id}/read`).catch(() => {});
    void reload();
    if (n.link) nav(n.link);
  };
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost relative p-2" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell size={18} />
        {!!data?.unread && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] leading-4 font-semibold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="card absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className="section-title">Notifications</span>
            <button className="text-xs text-indigo-600 hover:underline" onClick={async () => (await post("/notifications/read-all"), reload())}>
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data?.items.length ? (
              data.items.map((n) => (
                <button key={n._id} onClick={() => openItem(n)} className={`block w-full border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/60 ${n.read ? "opacity-60" : ""}`}>
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{n.title}</div>
                      {n.body && <div className="truncate text-xs muted">{n.body}</div>}
                      <div className="mt-0.5 text-[11px] muted">{timeAgo(n.createdAt)}</div>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="p-6 text-center text-sm muted">You're all caught up</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, org, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [mobileNav, setMobileNav] = useState(false);
  const [newTask, setNewTask] = useState(false);
  const [aiMode, setAiMode] = useState<"live" | "demo" | null>(null);
  useEffect(() => {
    get<{ mode: "live" | "demo" }>("/ai/status").then((r) => setAiMode(r.mode)).catch(() => {});
  }, []);
  // global shortcut: "n" opens the new-task modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setNewTask(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <Link to="/" className="mb-4 flex items-center gap-2 px-2 pt-1" onClick={() => setMobileNav(false)}>
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Work Tracker</div>
          <div className="max-w-36 truncate text-[11px] muted">{org?.name}</div>
        </div>
      </Link>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMobileNav(false)}
          className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
        >
          <Icon size={17} /> {label}
        </NavLink>
      ))}
      <div className="mt-auto space-y-2">
        {aiMode && (
          <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${aiMode === "live" ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`} title={aiMode === "demo" ? "Set ANTHROPIC_API_KEY on the server to use Claude" : "Claude is connected"}>
            <Sparkles size={13} /> AI: {aiMode === "live" ? "Claude (live)" : "demo mode"}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg px-2 py-2">
          <Avatar user={user} size={30} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{user?.name}</div>
            <div className="text-[11px] capitalize muted">{user?.role}</div>
          </div>
          <button className="btn-ghost p-1.5" onClick={logout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">{sidebar}</aside>
      {mobileNav && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMobileNav(false)}>
          <aside className="h-full w-64 bg-white dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <button className="btn-ghost absolute top-3 left-52 p-1" onClick={() => setMobileNav(false)}>
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/80 px-3 backdrop-blur sm:px-5 dark:border-slate-800 dark:bg-slate-900/80">
          <button className="btn-ghost p-2 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Menu">
            <Menu size={18} />
          </button>
          <button className="btn-ai" onClick={() => setNewTask(true)} title="New task (N)">
            <Plus size={16} /> <span className="hidden sm:inline">New task</span>
          </button>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <TimerPill />
            <Notifications />
            <button className="btn-ghost p-2" onClick={toggle} aria-label="Toggle dark mode">
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Suspense fallback={<div className="p-6 text-sm muted">Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <NewTaskModal open={newTask} onClose={() => setNewTask(false)} onCreated={() => window.dispatchEvent(new CustomEvent("wt:task-created"))} />
    </div>
  );
}
