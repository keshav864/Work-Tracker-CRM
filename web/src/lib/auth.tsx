import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { ApiError, get, post, setUnauthorizedHandler, tokenStore } from "./api";
import type { Org, User } from "./types";

interface AuthState {
  user: User | null;
  org: Org | null;
  loading: boolean;
  socket: Socket | null;
  login: (email: string, password: string) => Promise<void>;
  register: (b: { name: string; email: string; password: string; organization: string }) => Promise<void>;
  logout: () => void;
  can: (...roles: User["role"][]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setOrg(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return setLoading(false);
    get<{ user: User; org: Org }>("/auth/me")
      .then((r) => {
        setUser(r.user);
        setOrg(r.org);
      })
      .catch((e) => {
        // only a rejected token signs you out; network blips (e.g. API restarting) keep it
        if (e instanceof ApiError && e.status === 401) tokenStore.set(null);
      })
      .finally(() => setLoading(false));
  }, [logout]);

  // One authenticated Socket.IO connection per session (proxied by Vite in dev).
  useEffect(() => {
    if (!user) return;
    const s = io({ auth: { token: tokenStore.get() }, transports: ["websocket", "polling"] });
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [user?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<AuthState>(
    () => ({
      user,
      org,
      loading,
      socket,
      logout,
      can: (...roles) => !!user && roles.includes(user.role),
      login: async (email, password) => {
        const r = await post<{ token: string; user: User; org: Org }>("/auth/login", { email, password });
        tokenStore.set(r.token);
        setUser(r.user);
        setOrg(r.org);
      },
      register: async (b) => {
        const r = await post<{ token: string; user: User; org: Org }>("/auth/register", b);
        tokenStore.set(r.token);
        setUser(r.user);
        setOrg(r.org);
      },
    }),
    [user, org, loading, socket, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}

/** Subscribe to a Socket.IO event for the lifetime of the component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const { socket } = useAuth();
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);
}
