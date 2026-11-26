import { Router } from "express";
import { z } from "zod";
import { dropNulls, HttpError, me, notFound, objectId, optionalId, parse, requireAuth, requireRole } from "../lib/http.js";
import { Comment, Project, Task, TimeEntry } from "../models.js";
import { logActivity } from "../realtime.js";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const ProjectBody = z.object({
  name: z.string().min(1),
  key: z
    .string()
    .min(2)
    .max(6)
    .regex(/^[A-Za-z0-9]+$/, "Letters and digits only")
    .transform((s) => s.toUpperCase())
    .optional(),
  client: optionalId,
  description: z.string().optional(),
  status: z.enum(["planning", "active", "on_hold", "completed", "archived"]).optional(),
  color: z.string().optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  budgetHours: z.number().nonnegative().nullable().optional(),
  billable: z.boolean().optional(),
  hourlyRate: z.number().nonnegative().nullable().optional(),
  members: z.array(objectId).optional(),
});

/** Progress + hours per project, used by the list page and the dashboard. */
export async function projectProgress(projectIds: unknown[]) {
  const [taskAgg, timeAgg] = await Promise.all([
    Task.aggregate<{ _id: unknown; total: number; done: number; overdue: number }>([
      { $match: { project: { $in: projectIds } } },
      {
        $group: {
          _id: "$project",
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "done"] }, { $lt: ["$dueDate", new Date()] }, { $ne: ["$dueDate", null] }] }, 1, 0] } },
        },
      },
    ]),
    TimeEntry.aggregate<{ _id: unknown; minutes: number }>([{ $match: { project: { $in: projectIds } } }, { $group: { _id: "$project", minutes: { $sum: "$minutes" } } }]),
  ]);
  const T = new Map(taskAgg.map((x) => [String(x._id), x]));
  const H = new Map(timeAgg.map((x) => [String(x._id), x.minutes]));
  return (id: unknown) => {
    const t = T.get(String(id));
    return {
      taskCount: t?.total ?? 0,
      doneCount: t?.done ?? 0,
      overdueCount: t?.overdue ?? 0,
      progress: t?.total ? Math.round((t.done / t.total) * 100) : 0,
      hoursLogged: Math.round(((H.get(String(id)) ?? 0) / 60) * 10) / 10,
    };
  };
}

projectsRouter.get("/", async (req, res) => {
  const org = me(req).org;
  const filter: Record<string, unknown> = { org };
  if (typeof req.query.status === "string") filter.status = req.query.status;
  else filter.status = { $ne: "archived" };
  if (typeof req.query.client === "string") filter.client = req.query.client;
  const projects = await Project.find(filter).populate("client", "name").populate("owner", "name avatarColor").populate("members", "name avatarColor").sort({ updatedAt: -1 }).lean();
  const stats = await projectProgress(projects.map((p) => p._id));
  res.json(projects.map((p) => ({ ...p, ...stats(p._id) })));
});

projectsRouter.post("/", requireRole("admin", "manager"), async (req, res) => {
  const body = parse(ProjectBody, req.body);
  const org = me(req).org;
  const key = body.key ?? (body.name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 4).toUpperCase() || "PRJ");
  if (await Project.exists({ org, key })) throw new HttpError(409, `Project key ${key} is already used`);
  const project = await Project.create({ ...dropNulls(body), key, org, owner: me(req).id, members: body.members ?? [me(req).id] });
  await logActivity({ org, actor: me(req).id, verb: "project.created", summary: `created project ${project.name}`, project: project._id });
  res.status(201).json(project);
});

projectsRouter.get("/:id", async (req, res) => {
  const org = me(req).org;
  const project = await Project.findOne({ _id: req.params.id, org }).populate("client", "name hourlyRate").populate("owner", "name avatarColor").populate("members", "name avatarColor role title").lean();
  if (!project) throw notFound("Project");
  const stats = await projectProgress([project._id]);
  res.json({ ...project, ...stats(project._id) });
});

projectsRouter.patch("/:id", requireRole("admin", "manager"), async (req, res) => {
  const body = parse(ProjectBody.partial(), req.body);
  const org = me(req).org;
  if (body.key && (await Project.exists({ org, key: body.key, _id: { $ne: req.params.id } }))) throw new HttpError(409, `Project key ${body.key} is already used`);
  const before = await Project.findOne({ _id: req.params.id, org }).lean();
  const project = await Project.findOneAndUpdate({ _id: req.params.id, org }, body, { returnDocument: "after" }).lean();
  if (!project || !before) throw notFound("Project");
  if (body.status && body.status !== before.status) {
    await logActivity({ org, actor: me(req).id, verb: "project.status", summary: `set ${project.name} to ${body.status.replace("_", " ")}`, project: project._id });
  }
  res.json(project);
});

projectsRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const org = me(req).org;
  const project = await Project.findOneAndDelete({ _id: req.params.id, org });
  if (!project) throw notFound("Project");
  const taskIds = (await Task.find({ project: project._id }).select("_id").lean()).map((t) => t._id);
  await Promise.all([Task.deleteMany({ project: project._id }), Comment.deleteMany({ task: { $in: taskIds } }), TimeEntry.deleteMany({ project: project._id })]);
  res.status(204).end();
});
