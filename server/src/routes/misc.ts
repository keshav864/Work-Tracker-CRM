import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { aiMode, config } from "../config.js";
import { breakdownTask, estimateTask, parseTask, statusReport } from "../ai/features.js";
import { addDays, isoDate, startOfDay, startOfWeek } from "../lib/dates.js";
import { HttpError, me, notFound, objectId, parse, requireAuth } from "../lib/http.js";
import { Activity, Client, Notification, Project, Task, TimeEntry, User } from "../models.js";
import { projectProgress } from "./projects.js";

/* --------------------------------- dashboard --------------------------------- */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res) => {
  const u = me(req);
  const org = new mongoose.Types.ObjectId(u.org);
  const today = startOfDay(new Date());
  const weekStart = startOfWeek();
  const open = { $ne: "done" as const };

  const [members, openByUser, loggedByUser, weekByDay, overdue, myTasks, projects, activity, counts] = await Promise.all([
    User.find({ org, active: true }).select("name avatarColor title role weeklyCapacity").sort({ name: 1 }).lean(),
    Task.aggregate<{ _id: unknown; open: number; estimate: number; overdue: number; inProgress: number }>([
      { $match: { org, status: open, assignee: { $ne: null } } },
      {
        $group: {
          _id: "$assignee",
          open: { $sum: 1 },
          estimate: { $sum: { $ifNull: ["$estimateHours", 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", today] }] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] } },
        },
      },
    ]),
    TimeEntry.aggregate<{ _id: unknown; minutes: number }>([{ $match: { org, startedAt: { $gte: weekStart } } }, { $group: { _id: "$user", minutes: { $sum: "$minutes" } } }]),
    TimeEntry.aggregate<{ _id: string; billable: number; nonBillable: number }>([
      { $match: { org, startedAt: { $gte: weekStart, $lt: addDays(weekStart, 7) } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$startedAt", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
          billable: { $sum: { $cond: ["$billable", "$minutes", 0] } },
          nonBillable: { $sum: { $cond: ["$billable", 0, "$minutes"] } },
        },
      },
    ]),
    Task.find({ org, status: open, dueDate: { $lt: today } }).populate("assignee", "name avatarColor").populate("project", "name key color").sort({ dueDate: 1 }).limit(12).lean(),
    Task.find({ org, assignee: u.id, status: open }).populate("assignee", "name avatarColor").populate("project", "name key color").sort({ dueDate: 1, priority: -1 }).limit(10).lean(),
    Project.find({ org, status: { $in: ["active", "planning", "on_hold"] } }).populate("client", "name").sort({ dueDate: 1 }).limit(8).lean(),
    Activity.find({ org }).populate("actor", "name avatarColor").sort({ createdAt: -1 }).limit(20).lean(),
    Promise.all([
      Project.countDocuments({ org, status: "active" }),
      Task.countDocuments({ org, status: open }),
      Task.countDocuments({ org, status: open, dueDate: { $lt: today } }),
      Client.countDocuments({ org, status: "active" }),
      Task.countDocuments({ org, status: "done", completedAt: { $gte: weekStart } }),
    ]),
  ]);

  const O = new Map(openByUser.map((x) => [String(x._id), x]));
  const L = new Map(loggedByUser.map((x) => [String(x._id), x.minutes]));
  const D = new Map(weekByDay.map((x) => [x._id, x]));
  const stats = await projectProgress(projects.map((p) => p._id));
  const h = (m: number) => Math.round((m / 60) * 10) / 10;

  const byDay = Array.from({ length: 7 }, (_, i) => {
    const day = isoDate(addDays(weekStart, i));
    const d = D.get(day);
    return { day, billable: h(d?.billable ?? 0), nonBillable: h(d?.nonBillable ?? 0) };
  });
  const teamMinutes = loggedByUser.reduce((a, b) => a + b.minutes, 0);
  const billableMinutes = weekByDay.reduce((a, b) => a + b.billable, 0);

  res.json({
    counts: { activeProjects: counts[0], openTasks: counts[1], overdueTasks: counts[2], activeClients: counts[3], completedThisWeek: counts[4] },
    hoursThisWeek: { mine: h(L.get(u.id) ?? 0), team: h(teamMinutes), billable: h(billableMinutes), nonBillable: h(teamMinutes - billableMinutes), byDay },
    workload: members.map((m) => {
      const o = O.get(String(m._id));
      return {
        user: m,
        openTasks: o?.open ?? 0,
        inProgress: o?.inProgress ?? 0,
        overdue: o?.overdue ?? 0,
        estimateHours: Math.round((o?.estimate ?? 0) * 10) / 10,
        loggedHours: h(L.get(String(m._id)) ?? 0),
        capacityHours: m.weeklyCapacity ?? 40,
      };
    }),
    overdue,
    myTasks,
    projects: projects.map((p) => ({ ...p, ...stats(p._id) })),
    activity,
  });
});

/* ------------------------------- notifications ------------------------------- */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.get("/", async (req, res) => {
  const u = me(req);
  const [items, unread] = await Promise.all([
    Notification.find({ user: u.id }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ user: u.id, read: false }),
  ]);
  res.json({ items, unread });
});
notificationsRouter.post("/read-all", async (req, res) => {
  await Notification.updateMany({ user: me(req).id, read: false }, { read: true });
  res.json({ ok: true });
});
notificationsRouter.post("/:id/read", async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, user: me(req).id }, { read: true });
  res.json({ ok: true });
});

/* --------------------------------- activity --------------------------------- */
export const activityRouter = Router();
activityRouter.use(requireAuth);
activityRouter.get("/", async (req, res) => {
  const filter: Record<string, unknown> = { org: me(req).org };
  if (typeof req.query.project === "string") filter.project = req.query.project;
  if (typeof req.query.task === "string") filter.task = req.query.task;
  res.json(await Activity.find(filter).populate("actor", "name avatarColor").sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 30, 100)).lean());
});

/* ------------------------------------ AI ------------------------------------ */
export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.get("/status", (_req, res) => res.json({ mode: aiMode(), model: config.model }));

aiRouter.post("/parse-task", async (req, res) => {
  const body = parse(z.object({ text: z.string().min(3).max(1000), project: objectId.optional() }), req.body);
  res.json(await parseTask(me(req).org, body.text, body.project));
});

aiRouter.post("/breakdown", async (req, res) => {
  const body = parse(z.object({ task: objectId }), req.body);
  if (!(await Task.exists({ _id: body.task, org: me(req).org }))) throw notFound("Task");
  res.json(await breakdownTask(body.task, me(req).org));
});

aiRouter.post("/estimate", async (req, res) => {
  const body = parse(z.object({ task: objectId }), req.body);
  if (!(await Task.exists({ _id: body.task, org: me(req).org }))) throw notFound("Task");
  res.json(await estimateTask(body.task, me(req).org));
});

aiRouter.post("/status-report", async (req, res) => {
  const body = parse(z.object({ project: objectId }), req.body);
  if (!(await Project.exists({ _id: body.project, org: me(req).org }))) throw new HttpError(404, "Project not found");
  res.json(await statusReport(body.project, me(req).org));
});
