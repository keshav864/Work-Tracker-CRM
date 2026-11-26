import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { me, notFound, optionalId, parse, requireAuth, requireRole } from "../lib/http.js";
import { Client, Contact, Project, TimeEntry } from "../models.js";
import { logActivity } from "../realtime.js";

export const clientsRouter = Router();
clientsRouter.use(requireAuth);

const ClientBody = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  website: z.string().optional(),
  status: z.enum(["lead", "active", "paused", "churned"]).optional(),
  hourlyRate: z.number().nonnegative().nullable().optional(),
  notes: z.string().optional(),
  owner: optionalId,
});

clientsRouter.get("/", async (req, res) => {
  const org = me(req).org;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filter: Record<string, unknown> = { org };
  if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const clients = await Client.find(filter).populate("owner", "name avatarColor").sort({ name: 1 }).lean();
  const ids = clients.map((c) => c._id);
  const [projects, contacts, hours] = await Promise.all([
    Project.aggregate<{ _id: unknown; count: number; active: number }>([
      { $match: { client: { $in: ids } } },
      { $group: { _id: "$client", count: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } } } },
    ]),
    Contact.aggregate<{ _id: unknown; count: number }>([{ $match: { client: { $in: ids } } }, { $group: { _id: "$client", count: { $sum: 1 } } }]),
    TimeEntry.aggregate<{ _id: unknown; minutes: number; billable: number }>([
      { $match: { client: { $in: ids } } },
      { $group: { _id: "$client", minutes: { $sum: "$minutes" }, billable: { $sum: { $cond: ["$billable", "$minutes", 0] } } } },
    ]),
  ]);
  const by = <T extends { _id: unknown }>(xs: T[]) => new Map(xs.map((x) => [String(x._id), x]));
  const P = by(projects), C = by(contacts), H = by(hours);
  res.json(
    clients.map((c) => ({
      ...c,
      projectCount: P.get(String(c._id))?.count ?? 0,
      activeProjects: P.get(String(c._id))?.active ?? 0,
      contactCount: C.get(String(c._id))?.count ?? 0,
      hours: Math.round(((H.get(String(c._id))?.minutes ?? 0) / 60) * 10) / 10,
      billableHours: Math.round(((H.get(String(c._id))?.billable ?? 0) / 60) * 10) / 10,
    })),
  );
});

clientsRouter.post("/", requireRole("admin", "manager"), async (req, res) => {
  const body = parse(ClientBody, req.body);
  const client = await Client.create({ ...body, org: me(req).org, owner: body.owner ?? me(req).id });
  await logActivity({ org: me(req).org, actor: me(req).id, verb: "client.created", summary: `added client ${client.name}` });
  res.status(201).json(client);
});

clientsRouter.get("/:id", async (req, res) => {
  const org = me(req).org;
  const client = await Client.findOne({ _id: req.params.id, org }).populate("owner", "name avatarColor").lean();
  if (!client) throw notFound("Client");
  const [contacts, projects] = await Promise.all([
    Contact.find({ org, client: client._id }).sort({ isPrimary: -1, name: 1 }).lean(),
    Project.find({ org, client: client._id }).sort({ createdAt: -1 }).lean(),
  ]);
  res.json({ ...client, contacts, projects });
});

clientsRouter.patch("/:id", requireRole("admin", "manager"), async (req, res) => {
  const body = parse(ClientBody.partial(), req.body);
  const client = await Client.findOneAndUpdate({ _id: req.params.id, org: me(req).org }, body, { returnDocument: "after" }).lean();
  if (!client) throw notFound("Client");
  res.json(client);
});

clientsRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const org = me(req).org;
  const client = await Client.findOneAndDelete({ _id: req.params.id, org });
  if (!client) throw notFound("Client");
  await Contact.deleteMany({ org, client: client._id });
  await Project.updateMany({ org, client: client._id }, { $unset: { client: 1 } });
  res.status(204).end();
});

/* --------------------------------- contacts -------------------------------- */
const ContactBody = z.object({
  name: z.string().min(1),
  email: z.union([z.email(), z.literal("")]).optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

clientsRouter.post("/:id/contacts", requireRole("admin", "manager"), async (req, res) => {
  const org = me(req).org;
  if (!(await Client.exists({ _id: req.params.id, org }))) throw notFound("Client");
  const body = parse(ContactBody, req.body);
  if (body.isPrimary) await Contact.updateMany({ org, client: req.params.id }, { isPrimary: false });
  res.status(201).json(await Contact.create({ ...body, org, client: new mongoose.Types.ObjectId(String(req.params.id)) }));
});

clientsRouter.patch("/contacts/:contactId", requireRole("admin", "manager"), async (req, res) => {
  const org = me(req).org;
  const body = parse(ContactBody.partial(), req.body);
  const contact = await Contact.findOne({ _id: req.params.contactId, org });
  if (!contact) throw notFound("Contact");
  if (body.isPrimary) await Contact.updateMany({ org, client: contact.client }, { isPrimary: false });
  contact.set(body);
  await contact.save();
  res.json(contact);
});

clientsRouter.delete("/contacts/:contactId", requireRole("admin", "manager"), async (req, res) => {
  const r = await Contact.deleteOne({ _id: req.params.contactId, org: me(req).org });
  if (!r.deletedCount) throw notFound("Contact");
  res.status(204).end();
});
