import { Router } from "express";
import { z } from "zod";
import { HttpError, isManager, me, notFound, objectId, optionalId, parse, requireAuth, requireRole, type AuthUser } from "../lib/http.js";
import { addDays, isoDate, minutesBetween, parseLocalDate, startOfWeek } from "../lib/dates.js";
import { Client, Organization, Project, Task, TimeEntry, User } from "../models.js";
import { emitUser, logActivity } from "../realtime.js";

export const timeRouter = Router();
timeRouter.use(requireAuth);

const ENTRY_POPULATE = [
  { path: "task", select: "title number status" },
  { path: "project", select: "name key color" },
  { path: "client", select: "name" },
  { path: "user", select: "name avatarColor" },
];

async function resolveRefs(org: string, taskId?: string | null, projectId?: string | null) {
  if (taskId) {
    const task = await Task.findOne({ _id: taskId, org }).select("project").lean();
    if (!task) throw notFound("Task");
    projectId = String(task.project);
  }
  if (!projectId) throw new HttpError(400, "A task or project is required");
  const project = await Project.findOne({ _id: projectId, org }).select("client billable").lean();
  if (!project) throw notFound("Project");
  return { task: taskId ?? undefined, project: project._id, client: project.client ?? undefined, billable: project.billable ?? true };
}

const canSeeUser = (u: AuthUser, userId: string) => u.id === userId || isManager(u);

/* ----------------------------------- timer ----------------------------------- */
timeRouter.get("/current", async (req, res) => {
  const u = me(req);
  const running = await TimeEntry.findOne({ org: u.org, user: u.id, endedAt: null }).populate(ENTRY_POPULATE).lean();
  res.json(running ?? null);
});

timeRouter.post("/start", async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ task: optionalId, project: optionalId, description: z.string().optional() }), req.body);
  // only one running timer per user: stop the previous one first
  const prev = await TimeEntry.findOne({ org: u.org, user: u.id, endedAt: null });
  if (prev) {
    prev.endedAt = new Date();
    prev.minutes = minutesBetween(prev.startedAt, prev.endedAt);
    await prev.save();
  }
  const refs = await resolveRefs(u.org, body.task, body.project);
  const entry = await TimeEntry.create({ ...refs, org: u.org, user: u.id, description: body.description, startedAt: new Date(), endedAt: null, source: "timer" });
  // starting work on a todo task nudges it into "in progress"
  if (refs.task) await Task.updateOne({ _id: refs.task, status: { $in: ["backlog", "todo"] } }, { status: "in_progress" });
  const full = await TimeEntry.findById(entry._id).populate(ENTRY_POPULATE).lean();
  emitUser(u.id, "timer", full);
  res.status(201).json(full);
});

timeRouter.post("/stop", async (req, res) => {
  const u = me(req);
  const entry = await TimeEntry.findOne({ org: u.org, user: u.id, endedAt: null });
  if (!entry) throw new HttpError(400, "No timer is running");
  entry.endedAt = new Date();
  entry.minutes = Math.max(1, minutesBetween(entry.startedAt, entry.endedAt));
  await entry.save();
  const full = await TimeEntry.findById(entry._id).populate(ENTRY_POPULATE).lean();
  emitUser(u.id, "timer", null);
  await logActivity({ org: u.org, actor: u.id, verb: "time.logged", summary: `logged ${fmtMin(entry.minutes)}`, project: entry.project, task: entry.task });
  res.json(full);
});

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`);

/* -------------------------------- entries CRUD -------------------------------- */
timeRouter.get("/", async (req, res) => {
  const u = me(req);
  const q = req.query as Record<string, string | undefined>;
  const userId = q.user === "all" ? undefined : q.user || u.id;
  if (userId && !canSeeUser(u, userId)) throw new HttpError(403, "You can only see your own time");
  if (!userId && !isManager(u)) throw new HttpError(403, "You can only see your own time");
  const filter: Record<string, unknown> = { org: u.org };
  if (userId) filter.user = userId;
  if (q.project) filter.project = q.project;
  if (q.client) filter.client = q.client;
  if (q.task) filter.task = q.task;
  const from = q.from ? parseLocalDate(q.from) : addDays(new Date(), -30);
  const to = q.to ? addDays(parseLocalDate(q.to), 1) : addDays(new Date(), 1);
  filter.startedAt = { $gte: from, $lt: to };
  res.json(await TimeEntry.find(filter).sort({ startedAt: -1 }).limit(1000).populate(ENTRY_POPULATE).lean());
});

const ManualBody = z.object({
  task: optionalId,
  project: optionalId,
  description: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.number().int().positive().max(24 * 60),
  billable: z.boolean().optional(),
});

timeRouter.post("/", async (req, res) => {
  const u = me(req);
  const body = parse(ManualBody, req.body);
  const refs = await resolveRefs(u.org, body.task, body.project);
  const startedAt = parseLocalDate(body.date);
  startedAt.setHours(9, 0, 0, 0);
  const entry = await TimeEntry.create({
    ...refs,
    billable: body.billable ?? refs.billable,
    org: u.org,
    user: u.id,
    description: body.description,
    startedAt,
    endedAt: new Date(startedAt.getTime() + body.minutes * 60000),
    minutes: body.minutes,
    source: "manual",
  });
  await logActivity({ org: u.org, actor: u.id, verb: "time.logged", summary: `logged ${fmtMin(body.minutes)}`, project: refs.project, task: refs.task });
  res.status(201).json(await TimeEntry.findById(entry._id).populate(ENTRY_POPULATE).lean());
});

timeRouter.patch("/:id", async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ description: z.string().optional(), minutes: z.number().int().positive().max(1440).optional(), billable: z.boolean().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
  const entry = await TimeEntry.findOne({ _id: req.params.id, org: u.org });
  if (!entry) throw notFound("Time entry");
  if (String(entry.user) !== u.id && !isManager(u)) throw new HttpError(403, "You can only edit your own time");
  if (body.description !== undefined) entry.description = body.description;
  if (body.billable !== undefined) entry.billable = body.billable;
  if (body.date) {
    const d = parseLocalDate(body.date);
    d.setHours(entry.startedAt.getHours(), entry.startedAt.getMinutes());
    entry.startedAt = d;
  }
  if (body.minutes) entry.minutes = body.minutes;
  if (entry.endedAt) entry.endedAt = new Date(entry.startedAt.getTime() + entry.minutes * 60000);
  await entry.save();
  res.json(await TimeEntry.findById(entry._id).populate(ENTRY_POPULATE).lean());
});

timeRouter.delete("/:id", async (req, res) => {
  const u = me(req);
  const entry = await TimeEntry.findOne({ _id: req.params.id, org: u.org });
  if (!entry) throw notFound("Time entry");
  if (String(entry.user) !== u.id && !isManager(u)) throw new HttpError(403, "You can only delete your own time");
  await entry.deleteOne();
  res.status(204).end();
});

/* --------------------------------- timesheet --------------------------------- */
/** GET /time/timesheet?week=YYYY-MM-DD&user=<id> — a Mon–Sun grid of hours per project/task. */
timeRouter.get("/timesheet", async (req, res) => {
  const u = me(req);
  const userId = typeof req.query.user === "string" && req.query.user ? req.query.user : u.id;
  if (!canSeeUser(u, userId)) throw new HttpError(403, "You can only see your own timesheet");
  const weekStart = startOfWeek(typeof req.query.week === "string" ? parseLocalDate(req.query.week) : new Date());
  const weekEnd = addDays(weekStart, 7);
  const [user, entries] = await Promise.all([
    User.findOne({ _id: userId, org: u.org }).select("name weeklyCapacity avatarColor").lean(),
    TimeEntry.find({ org: u.org, user: userId, startedAt: { $gte: weekStart, $lt: weekEnd } }).sort({ startedAt: 1 }).populate(ENTRY_POPULATE).lean() as unknown as Promise<
      { _id: unknown; minutes: number; billable: boolean; startedAt: Date; endedAt?: Date | null; project?: { _id: unknown; name: string; key: string; color: string } | null; task?: { _id: unknown; title: string; number: number } | null }[]
    >,
  ]);
  if (!user) throw notFound("User");
  const days = Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i)));
  const rows = new Map<string, { key: string; project: unknown; task: unknown; days: number[]; total: number; billable: number }>();
  const dayTotals = Array(7).fill(0) as number[];
  let billable = 0;
  for (const e of entries) {
    const minutes = e.endedAt ? e.minutes : minutesBetween(e.startedAt, new Date());
    const key = `${String(e.project?._id)}:${String(e.task?._id ?? "")}`;
    const row = rows.get(key) ?? { key, project: e.project, task: e.task ?? null, days: Array(7).fill(0), total: 0, billable: 0 };
    const idx = Math.floor((e.startedAt.getTime() - weekStart.getTime()) / 86_400_000);
    if (idx >= 0 && idx < 7) {
      row.days[idx] += minutes;
      dayTotals[idx] += minutes;
    }
    row.total += minutes;
    if (e.billable) {
      row.billable += minutes;
      billable += minutes;
    }
    rows.set(key, row);
  }
  const total = dayTotals.reduce((a, b) => a + b, 0);
  res.json({ user, weekStart: days[0], days, rows: [...rows.values()].sort((a, b) => b.total - a.total), dayTotals, totalMinutes: total, billableMinutes: billable, nonBillableMinutes: total - billable, capacityMinutes: (user.weeklyCapacity ?? 40) * 60 });
});

/* ---------------------------------- invoice ---------------------------------- */
/**
 * GET /time/invoice?client=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Billable hours grouped by project and person, priced with the most specific rate:
 * project rate → client rate → person's rate → workspace default.
 */
timeRouter.get("/invoice", requireRole("admin", "manager"), async (req, res) => {
  const u = me(req);
  const q = parse(z.object({ client: objectId, from: z.string().optional(), to: z.string().optional() }), req.query);
  const from = q.from ? parseLocalDate(q.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = q.to ? addDays(parseLocalDate(q.to), 1) : addDays(new Date(), 1);
  const [client, org] = await Promise.all([Client.findOne({ _id: q.client, org: u.org }).lean(), Organization.findById(u.org).lean()]);
  if (!client) throw notFound("Client");
  const entries = await TimeEntry.find({ org: u.org, client: client._id, startedAt: { $gte: from, $lt: to }, endedAt: { $ne: null } })
    .populate("project", "name key hourlyRate")
    .populate("user", "name hourlyRate")
    .lean();
  type P = { _id: unknown; name: string; key: string; hourlyRate?: number | null };
  type U = { _id: unknown; name: string; hourlyRate?: number | null };
  const lines = new Map<string, { project: string; projectKey: string; person: string; rate: number; billableMinutes: number; nonBillableMinutes: number }>();
  for (const e of entries) {
    const p = e.project as unknown as P | null;
    const usr = e.user as unknown as U | null;
    if (!p || !usr) continue;
    const rate = p.hourlyRate ?? client.hourlyRate ?? usr.hourlyRate ?? org?.defaultHourlyRate ?? 0;
    const key = `${String(p._id)}:${String(usr._id)}:${rate}`;
    const line = lines.get(key) ?? { project: p.name, projectKey: p.key, person: usr.name, rate, billableMinutes: 0, nonBillableMinutes: 0 };
    if (e.billable) line.billableMinutes += e.minutes;
    else line.nonBillableMinutes += e.minutes;
    lines.set(key, line);
  }
  const out = [...lines.values()]
    .map((l) => ({ ...l, billableHours: Math.round((l.billableMinutes / 60) * 100) / 100, amount: Math.round((l.billableMinutes / 60) * l.rate * 100) / 100 }))
    .sort((a, b) => a.project.localeCompare(b.project) || b.amount - a.amount);
  const subtotal = Math.round(out.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  res.json({
    client: { _id: client._id, name: client.name },
    currency: org?.currency ?? "USD",
    from: isoDate(from),
    to: isoDate(addDays(to, -1)),
    lines: out,
    billableHours: Math.round(out.reduce((a, l) => a + l.billableMinutes, 0) / 6) / 10,
    nonBillableHours: Math.round(out.reduce((a, l) => a + l.nonBillableMinutes, 0) / 6) / 10,
    subtotal,
  });
});
