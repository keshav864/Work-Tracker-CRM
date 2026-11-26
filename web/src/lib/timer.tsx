import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, post } from "./api";
import { useAuth, useSocketEvent } from "./auth";
import type { TimeEntry } from "./types";
import { toast } from "../components/ui";

interface TimerState {
  running: TimeEntry | null;
  start: (opts: { task?: string; project?: string; description?: string }) => Promise<void>;
  stop: () => Promise<TimeEntry | null>;
}
const Ctx = createContext<TimerState | null>(null);

/** Global running-timer state, kept in sync across tabs/devices via the `timer` socket event. */
export function TimerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [running, setRunning] = useState<TimeEntry | null>(null);

  useEffect(() => {
    if (!user) return setRunning(null);
    get<TimeEntry | null>("/time/current").then(setRunning).catch(() => {});
  }, [user]);

  useSocketEvent<TimeEntry | null>("timer", useCallback((e) => setRunning(e), []));

  const value = useMemo<TimerState>(
    () => ({
      running,
      start: async (opts) => {
        const e = await post<TimeEntry>("/time/start", opts);
        setRunning(e);
        toast(`Timer started${e.task ? ` · ${e.task.title}` : ""}`);
      },
      stop: async () => {
        const e = await post<TimeEntry>("/time/stop");
        setRunning(null);
        toast(`Logged ${e.minutes}m`);
        window.dispatchEvent(new CustomEvent("wt:time-logged"));
        return e;
      },
    }),
    [running],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTimer() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTimer outside provider");
  return c;
}
