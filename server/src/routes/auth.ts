import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError, isManager, me, parse, requireAuth, requireRole, signToken } from "../lib/http.js";
import { Organization, ROLES, User } from "../models.js";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
const publicUser = (u: { _id: unknown; name: string; email: string; role: string; title?: string | null; avatarColor?: string | null; hourlyRate?: number | null; weeklyCapacity?: number | null; active?: boolean | null; org: unknown }) => ({
  _id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  title: u.title,
  avatarColor: u.avatarColor,
  hourlyRate: u.hourlyRate,
  weeklyCapacity: u.weeklyCapacity,
  active: u.active,
  org: String(u.org),
});

export const authRouter = Router();

/** Sign up: creates a new organization (workspace) with the caller as admin. */
authRouter.post("/register", async (req, res) => {
  const body = parse(
    z.object({ name: z.string().min(2), email: z.email(), password: z.string().min(8), organization: z.string().min(2) }),
    req.body,
  );
  if (await User.exists({ email: body.email.toLowerCase() })) throw new HttpError(409, "An account with that email already exists");
  const slugBase = body.organization.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  const slug = (await Organization.exists({ slug: slugBase })) ? `${slugBase}-${Date.now().toString(36)}` : slugBase;
  const org = await Organization.create({ name: body.organization, slug });
  const user = await User.create({ org: org._id, name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 10), role: "admin", avatarColor: COLORS[0] });
  res.status(201).json({ token: signToken(user), user: publicUser(user), org });
});

authRouter.post("/login", async (req, res) => {
  const body = parse(z.object({ email: z.email(), password: z.string().min(1) }), req.body);
  const user = await User.findOne({ email: body.email.toLowerCase() }).select("+passwordHash");
  if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash))) throw new HttpError(401, "Invalid email or password");
  const org = await Organization.findById(user.org).lean();
  res.json({ token: signToken(user), user: publicUser(user), org });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const u = await User.findById(me(req).id).lean();
  const org = await Organization.findById(me(req).org).lean();
  if (!u) throw new HttpError(401, "Not authenticated");
  res.json({ user: publicUser(u), org });
});

/* ------------------------------ team management ----------------------------- */
export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get("/", async (req, res) => {
  const users = await User.find({ org: me(req).org }).sort({ name: 1 }).lean();
  res.json(users.map(publicUser));
});

/** Admins add teammates directly (an invite email would go here in production). */
usersRouter.post("/", requireRole("admin"), async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().min(2),
      email: z.email(),
      password: z.string().min(8),
      role: z.enum(ROLES).default("member"),
      title: z.string().optional(),
      hourlyRate: z.number().nonnegative().optional(),
      weeklyCapacity: z.number().positive().max(80).optional(),
    }),
    req.body,
  );
  const count = await User.countDocuments({ org: me(req).org });
  const user = await User.create({ ...body, org: me(req).org, passwordHash: await bcrypt.hash(body.password, 10), avatarColor: COLORS[count % COLORS.length] });
  res.status(201).json(publicUser(user));
});

usersRouter.patch("/:id", async (req, res) => {
  const actor = me(req);
  const self = actor.id === req.params.id;
  if (!self && actor.role !== "admin") throw new HttpError(403, "Only admins can edit teammates");
  const body = parse(
    z.object({
      name: z.string().min(2).optional(),
      title: z.string().optional(),
      role: z.enum(ROLES).optional(),
      hourlyRate: z.number().nonnegative().optional(),
      weeklyCapacity: z.number().positive().max(80).optional(),
      active: z.boolean().optional(),
      password: z.string().min(8).optional(),
    }),
    req.body,
  );
  if ((body.role || body.active !== undefined || body.hourlyRate !== undefined) && actor.role !== "admin") throw new HttpError(403, "Only admins can change roles, rates or status");
  if (self && (body.role && body.role !== "admin" || body.active === false)) throw new HttpError(400, "You can't demote or deactivate yourself");
  const { password, ...rest } = body;
  const update: Record<string, unknown> = { ...rest };
  if (password) update.passwordHash = await bcrypt.hash(password, 10);
  const user = await User.findOneAndUpdate({ _id: req.params.id, org: actor.org }, update, { returnDocument: "after" }).lean();
  if (!user) throw new HttpError(404, "User not found");
  res.json(publicUser(user));
});

/* ------------------------------- organization ------------------------------- */
export const orgRouter = Router();
orgRouter.use(requireAuth);
orgRouter.get("/", async (req, res) => res.json(await Organization.findById(me(req).org).lean()));
orgRouter.patch("/", async (req, res) => {
  if (!isManager(me(req)) || me(req).role !== "admin") throw new HttpError(403, "Only admins can edit the workspace");
  const body = parse(z.object({ name: z.string().min(2).optional(), currency: z.string().length(3).optional(), defaultHourlyRate: z.number().nonnegative().optional() }), req.body);
  res.json(await Organization.findByIdAndUpdate(me(req).org, body, { returnDocument: "after" }).lean());
});
