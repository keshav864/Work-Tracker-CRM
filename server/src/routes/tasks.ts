import { Router } from "express";
import { z } from "zod";
import { dropNulls, HttpError, isManager, me, notFound, objectId, optionalId, parse, requireAuth } from "../lib/http.js";
import { startOfDay } from "../lib/dates.js";
import { Comment, PRIORITIES, Project, STATUSES, Task, TimeEntry, User } from "../models.js";
import { emitOrg, logActivity, notify } from "../realtime.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const STATUS_LABEL: Record<string, string> = { backlog: "Backlog", todo: "To do", in_progress: "In progress", review: "Review", done: "Done" };

const TaskBody = z.object({
  project: objectId,
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: optionalId,
  dueDate: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  estimateHours: z.number().nonnegative().nullable().optional(),
  labels: z.array(z.string().min(1).max(30)).max(10).optional(),
  subtasks: z.array(z.object({ title: z.string().min(1), done: z.boolean().optional() })).optional(),
});

export async function loadTask(id: unknown, org: string) {
  return Task.findOne({ _id: id, org })
    .populate("assignee", "name avatarColor email")
    .populate("reporter", "name avatarColor")
    .populate("project", "name key color client")
    .lean();
}

async function withCounts<T extends { _id: unknown }>(tasks: T[]) {
  const ids = tasks.map((t) => t._id);
  const [comments, time] = await Promise.all([
    Comment.aggregate<{ _id: unknown; n: number }>([{ $match: { task: { $in: ids } } }, { $group: { _id: "$task", n: { $sum: 1 } } }]),
    TimeEntry.aggregate<{ _id: unknown; m: number }>([{ $match: { task: { $in: ids } } }, { $group: { _id: "$task", m: { $sum: "$minutes" } } }]),
  ]);
  const C = new Map(comments.map((c) => [String(c._id), c.n]));
  const M = new Map(time.map((c) => [String(c._id), c.m]));
  return tasks.map((t) => ({ ...t, commentCount: C.get(String(t._id)) ?? 0, loggedMinutes: M.get(String(t._id)) ?? 0 }));
}

async function broadcast(org: string, taskId: unknown) {
  const t = await loadTask(taskId, org);
  if (t) emitOrg(org, "task:updated", (await withCounts([t]))[0]);
  return t;
}

/** GET /tasks?project=&assignee=me|<id>&status=&priority=&q=&overdue=1&label= */
tasksRouter.get("/", async (req, res) => {
  const u = me(req);
  const q = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = { org: u.org };
  if (q.project) filter.project = q.project;
  if (q.assignee) filter.assignee = q.assignee === "me" ? u.id : q.assignee === "none" ? null : q.assignee;
  if (q.status) filter.status = { $in: q.status.split(",") };
  if (q.priority) filter.priority = q.priority;
  if (q.label) filter.labels = q.label;
  if (q.overdue === "1") Object.assign(filter, { status: { $ne: "done" }, dueDate: { $lt: startOfDay(new Date()) } });
  if (q.q) filter.title = { $regex: q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const tasks = await Task.find(filter)
    .populate("assignee", "name avatarColor")
    .populate("project", "name key color")
    .sort(q.project ? { order: 1, createdAt: 1 } : { dueDate: 1, priority: -1 })
    .limit(Math.min(Number(q.limit) || 500, 1000))
    .lean();
  res.json(await withCounts(tasks));
});

tasksRouter.post("/", async (req, res) => {
  const u = me(req);
  const body = parse(TaskBody, req.body);
  // atomically allocate the next task number for the project (e.g. WEB-42)
  const project = await Project.findOneAndUpdate({ _id: body.project, org: u.org }, { $inc: { taskSeq: 1 } }, { returnDocument: "after" });
  if (!project) throw notFound("Project");
  if (body.assignee && !(await User.exists({ _id: body.assignee, org: u.org }))) throw new HttpError(400, "Assignee is not in this workspace");
  const status = body.status ?? "todo";
  const last = await Task.findOne({ project: project._id, status }).sort({ order: -1 }).select("order").lean();
  const task = await Task.create({
    ...dropNulls(body),
    org: u.org,
    number: project.taskSeq,
    status,
    order: (last?.order ?? 0) + 1000,
    reporter: u.id,
    completedAt: status === "done" ? new Date() : undefined,
  });
  await logActivity({ org: u.org, actor: u.id, verb: "task.created", summary: `created ${project.key}-${task.number} “${task.title}”`, project: project._id, task: task._id });
  if (task.assignee) {
    await notify({ org: u.org, user: String(task.assignee), actor: u.id, type: "assigned", title: `${u.name} assigned you ${project.key}-${task.number}`, body: task.title, link: `/projects/${project._id}?task=${task._id}` });
  }
  const full = await loadTask(task._id, u.org);
  const [withC] = await withCounts([full!]);
  emitOrg(u.org, "task:created", withC);
  res.status(201).json(withC);
});

tasksRouter.get("/:id", async (req, res) => {
  const u = me(req);
  const task = await loadTask(req.params.id, u.org);
  if (!task) throw notFound("Task");
  const [comments, time] = await Promise.all([
    Comment.find({ task: task._id }).populate("author", "name avatarColor").sort({ createdAt: 1 }).lean(),
    TimeEntry.find({ task: task._id }).populate("user", "name avatarColor").sort({ startedAt: -1 }).lean(),
  ]);
  res.json({ ...task, comments, timeEntries: time, loggedMinutes: time.reduce((a, t) => a + (t.minutes ?? 0), 0) });
});

tasksRouter.patch("/:id", async (req, res) => {
  const u = me(req);
  const body = parse(TaskBody.omit({ project: true }).partial(), req.body);
  const task = await Task.findOne({ _id: req.params.id, org: u.org });
  if (!task) throw notFound("Task");
  const project = await Project.findById(task.project).select("key name").lean();
  const ref = `${project?.key}-${task.number}`;
  const prevAssignee = task.assignee ? String(task.assignee) : null;
  const prevStatus = task.status;
  if (body.status && body.status !== prevStatus) {
    task.completedAt = body.status === "done" ? new Date() : undefined;
    const last = await Task.findOne({ project: task.project, status: body.status }).sort({ order: -1 }).select("order").lean();
    task.order = (last?.order ?? 0) + 1000;
  }
  task.set(body);
  await task.save();

  if (body.status && body.status !== prevStatus) {
    await logActivity({ org: u.org, actor: u.id, verb: "task.moved", summary: `moved ${ref} to ${STATUS_LABEL[body.status]}`, project: task.project, task: task._id, meta: { from: prevStatus, to: body.status } });
  }
  if (body.assignee !== undefined && (body.assignee ?? null) !== prevAssignee && body.assignee) {
    await notify({ org: u.org, user: body.assignee, actor: u.id, type: "assigned", title: `${u.name} assigned you ${ref}`, body: task.title, link: `/projects/${task.project}?task=${task._id}` });
    await logActivity({ org: u.org, actor: u.id, verb: "task.assigned", summary: `assigned ${ref}`, project: task.project, task: task._id });
  }
  res.json(await broadcast(u.org, task._id));
});

/** Kanban drag & drop: set status and position. `order` is a fractional index between neighbours. */
tasksRouter.post("/:id/move", async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ status: z.enum(STATUSES), order: z.number() }), req.body);
  const task = await Task.findOne({ _id: req.params.id, org: u.org });
  if (!task) throw notFound("Task");
  const from = task.status;
  task.status = body.status;
  task.order = body.order;
  if (from !== body.status) task.completedAt = body.status === "done" ? new Date() : undefined;
  await task.save();
  if (from !== body.status) {
    const project = await Project.findById(task.project).select("key").lean();
    const ref = `${project?.key}-${task.number}`;
    await logActivity({ org: u.org, actor: u.id, verb: "task.moved", summary: `moved ${ref} to ${STATUS_LABEL[body.status]}`, project: task.project, task: task._id, meta: { from, to: body.status } });
    const watchers = new Set([task.assignee, task.reporter].filter(Boolean).map(String));
    for (const w of watchers) {
      await notify({ org: u.org, user: w, actor: u.id, type: "status", title: `${ref} moved to ${STATUS_LABEL[body.status]}`, body: task.title, link: `/projects/${task.project}?task=${task._id}` });
    }
  }
  res.json(await broadcast(u.org, task._id));
});

tasksRouter.delete("/:id", async (req, res) => {
  const u = me(req);
  const task = await Task.findOne({ _id: req.params.id, org: u.org });
  if (!task) throw notFound("Task");
  if (!isManager(u) && String(task.reporter) !== u.id) throw new HttpError(403, "Only managers or the task's creator can delete it");
  await Promise.all([task.deleteOne(), Comment.deleteMany({ task: task._id }), TimeEntry.updateMany({ task: task._id }, { $unset: { task: 1 } })]);
  emitOrg(u.org, "task:deleted", { _id: String(task._id), project: String(task.project) });
  res.status(204).end();
});

/* ------------------------------ subtasks / checklist ----------------------------- */
tasksRouter.post("/:id/subtasks", async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ titles: z.array(z.string().min(1)).min(1).max(20) }), req.body);
  const r = await Task.updateOne({ _id: req.params.id, org: u.org }, { $push: { subtasks: { $each: body.titles.map((title) => ({ title, done: false })) } } });
  if (!r.matchedCount) throw notFound("Task");
  res.status(201).json(await broadcast(u.org, req.params.id));
});

tasksRouter.patch("/:id/subtasks/:sid", async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ title: z.string().min(1).optional(), done: z.boolean().optional() }), req.body);
  const set: Record<string, unknown> = {};
  if (body.title !== undefined) set["subtasks.$.title"] = body.title;
  if (body.done !== undefined) set["subtasks.$.done"] = body.done;
  const r = await Task.updateOne({ _id: req.params.id, org: u.org, "subtasks._id": req.params.sid }, { $set: set });
  if (!r.matchedCount) throw notFound("Subtask");
  res.json(await broadcast(u.org, req.params.id));
});

tasksRouter.delete("/:id/subtasks/:sid", async (req, res) => {
  const u = me(req);
  await Task.updateOne({ _id: req.params.id, org: u.org }, { $pull: { subtasks: { _id: req.params.sid } } });
  res.json(await broadcast(u.org, req.params.id));
});

/* ------------------------------ attachments (metadata) ---------------------------- */
tasksRouter.post("/:id/attachments", async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ name: z.string().min(1), url: z.url().optional(), size: z.number().nonnegative().optional(), mimeType: z.string().optional() }), req.body);
  const r = await Task.updateOne({ _id: req.params.id, org: u.org }, { $push: { attachments: { ...body, uploadedBy: u.id, uploadedAt: new Date() } } });
  if (!r.matchedCount) throw notFound("Task");
  res.status(201).json(await broadcast(u.org, req.params.id));
});

tasksRouter.delete("/:id/attachments/:aid", async (req, res) => {
  const u = me(req);
  await Task.updateOne({ _id: req.params.id, org: u.org }, { $pull: { attachments: { _id: req.params.aid } } });
  res.json(await broadcast(u.org, req.params.id));
});

/* ---------------------------------- comments ---------------------------------- */
tasksRouter.get("/:id/comments", async (req, res) => {
  const u = me(req);
  if (!(await Task.exists({ _id: req.params.id, org: u.org }))) throw notFound("Task");
  res.json(await Comment.find({ task: req.params.id }).populate("author", "name avatarColor").sort({ createdAt: 1 }).lean());
});

tasksRouter.post("/:id/comments", async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ body: z.string().min(1).max(5000) }), req.body);
  const task = await Task.findOne({ _id: req.params.id, org: u.org }).lean();
  if (!task) throw notFound("Task");
  const project = await Project.findById(task.project).select("key").lean();
  const ref = `${project?.key}-${task.number}`;
  // @mentions: "@Priya" or "@Priya Shah" matched against teammates' names
  const team = await User.find({ org: u.org, active: true }).select("name").lean();
  const mentions = team.filter((m) => new RegExp(`@${m.name.split(" ")[0]}\\b`, "i").test(body.body)).map((m) => String(m._id));
  const comment = await Comment.create({ org: u.org, task: task._id, author: u.id, body: body.body, mentions });
  const populated = await comment.populate("author", "name avatarColor");
  const link = `/projects/${task.project}?task=${task._id}`;
  for (const m of mentions) await notify({ org: u.org, user: m, actor: u.id, type: "mention", title: `${u.name} mentioned you on ${ref}`, body: body.body.slice(0, 140), link });
  for (const w of new Set([task.assignee, task.reporter].filter(Boolean).map(String))) {
    if (!mentions.includes(w)) await notify({ org: u.org, user: w, actor: u.id, type: "comment", title: `${u.name} commented on ${ref}`, body: body.body.slice(0, 140), link });
  }
  await logActivity({ org: u.org, actor: u.id, verb: "comment.created", summary: `commented on ${ref}`, project: task.project, task: task._id });
  emitOrg(u.org, "comment:created", { taskId: String(task._id), project: String(task.project), comment: populated.toObject() });
  res.status(201).json(populated);
});

tasksRouter.delete("/comments/:cid", async (req, res) => {
  const u = me(req);
  const c = await Comment.findOne({ _id: req.params.cid, org: u.org });
  if (!c) throw notFound("Comment");
  if (String(c.author) !== u.id && !isManager(u)) throw new HttpError(403, "You can only delete your own comments");
  await c.deleteOne();
  emitOrg(u.org, "comment:deleted", { taskId: String(c.task), commentId: String(c._id) });
  res.status(204).end();
});
