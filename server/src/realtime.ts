import type { Server as HttpServer } from "node:http";
import type { Types } from "mongoose";
import { Server } from "socket.io";
import { config } from "./config.js";
import { userFromToken } from "./lib/http.js";
import { Activity, Notification } from "./models.js";

/**
 * Socket.IO hub. Each authenticated socket joins `org:<id>` (team-wide events like task moves and
 * comments) and `user:<id>` (personal notifications). When no server is attached (tests, scripts)
 * emits are no-ops.
 */
let io: Server | null = null;

export function attachRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: config.corsOrigin.split(","), credentials: true } });
  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: string })?.token ?? "";
    const user = await userFromToken(token);
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });
  io.on("connection", (socket) => {
    const u = socket.data.user as { id: string; org: string };
    socket.join(`org:${u.org}`);
    socket.join(`user:${u.id}`);
    // presence: who is looking at which project board
    socket.on("project:join", (projectId: string) => socket.join(`project:${projectId}`));
    socket.on("project:leave", (projectId: string) => socket.leave(`project:${projectId}`));
  });
  return io;
}

export function emitOrg(org: string, event: string, payload: unknown, exceptSocket?: string) {
  if (!io) return;
  const target = io.to(`org:${org}`);
  (exceptSocket ? target.except(exceptSocket) : target).emit(event, payload);
}

export function emitUser(user: string, event: string, payload: unknown) {
  io?.to(`user:${user}`).emit(event, payload);
}

/** Record an activity-feed entry and broadcast it to the org. */
export async function logActivity(a: {
  org: string;
  actor?: string;
  verb: string;
  summary: string;
  project?: Types.ObjectId | string | null;
  task?: Types.ObjectId | string | null;
  meta?: unknown;
}) {
  const doc = await Activity.create({ ...a, project: a.project ?? undefined, task: a.task ?? undefined });
  const populated = await doc.populate("actor", "name avatarColor");
  emitOrg(a.org, "activity", populated.toObject());
  return doc;
}

/** Create an in-app notification (skips notifying yourself) and push it over the socket. */
export async function notify(n: {
  org: string;
  user: string;
  actor?: string;
  type: "assigned" | "comment" | "mention" | "status" | "due_soon" | "system";
  title: string;
  body?: string;
  link?: string;
}) {
  if (n.actor && n.actor === n.user) return null;
  const doc = await Notification.create({ org: n.org, user: n.user, type: n.type, title: n.title, body: n.body, link: n.link });
  emitUser(n.user, "notification", doc.toObject());
  return doc;
}
