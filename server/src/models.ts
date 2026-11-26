import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";

const { model } = mongoose;
const ref = (name: string, required = false) => ({ type: Schema.Types.ObjectId, ref: name, required });
const opts = { timestamps: true } as const;

/* ------------------------------- Organization ------------------------------ */
const orgSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    currency: { type: String, default: "USD" },
    defaultHourlyRate: { type: Number, default: 100 },
  },
  opts,
);
export const Organization = model("Organization", orgSchema);

/* ----------------------------------- User ---------------------------------- */
export const ROLES = ["admin", "manager", "member"] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    org: ref("Organization", true),
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "member" },
    title: String,
    hourlyRate: Number,
    weeklyCapacity: { type: Number, default: 40 },
    avatarColor: { type: String, default: "#6366f1" },
    active: { type: Boolean, default: true },
  },
  opts,
);
export const User = model("User", userSchema);

/* ------------------------------ Client / Contact --------------------------- */
const clientSchema = new Schema(
  {
    org: ref("Organization", true),
    name: { type: String, required: true },
    industry: String,
    website: String,
    status: { type: String, enum: ["lead", "active", "paused", "churned"], default: "active" },
    hourlyRate: Number,
    notes: String,
    owner: ref("User"),
  },
  opts,
);
clientSchema.index({ org: 1, name: 1 });
export const Client = model("Client", clientSchema);

const contactSchema = new Schema(
  {
    org: ref("Organization", true),
    client: ref("Client", true),
    name: { type: String, required: true },
    email: String,
    phone: String,
    title: String,
    isPrimary: { type: Boolean, default: false },
  },
  opts,
);
export const Contact = model("Contact", contactSchema);

/* --------------------------------- Project --------------------------------- */
const projectSchema = new Schema(
  {
    org: ref("Organization", true),
    client: ref("Client"),
    name: { type: String, required: true },
    key: { type: String, required: true }, // short code used in task numbers, e.g. "WEB"
    description: String,
    status: { type: String, enum: ["planning", "active", "on_hold", "completed", "archived"], default: "active" },
    color: { type: String, default: "#6366f1" },
    startDate: Date,
    dueDate: Date,
    budgetHours: Number,
    billable: { type: Boolean, default: true },
    hourlyRate: Number,
    members: [ref("User")],
    owner: ref("User"),
    taskSeq: { type: Number, default: 0 },
  },
  opts,
);
projectSchema.index({ org: 1, status: 1 });
export const Project = model("Project", projectSchema);

/* ---------------------------------- Task ----------------------------------- */
export const STATUSES = ["backlog", "todo", "in_progress", "review", "done"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskStatus = (typeof STATUSES)[number];

const subtaskSchema = new Schema({ title: { type: String, required: true }, done: { type: Boolean, default: false } }, { _id: true });
const attachmentSchema = new Schema(
  {
    name: { type: String, required: true },
    url: String,
    size: Number,
    mimeType: String,
    uploadedBy: ref("User"),
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const taskSchema = new Schema(
  {
    org: ref("Organization", true),
    project: ref("Project", true),
    number: { type: Number, required: true },
    title: { type: String, required: true },
    description: String,
    status: { type: String, enum: STATUSES, default: "todo" },
    priority: { type: String, enum: PRIORITIES, default: "medium" },
    order: { type: Number, default: 0 }, // position within its Kanban column
    assignee: ref("User"),
    reporter: ref("User"),
    dueDate: Date,
    startDate: Date,
    estimateHours: Number,
    labels: [String],
    subtasks: [subtaskSchema],
    attachments: [attachmentSchema],
    completedAt: Date,
  },
  opts,
);
taskSchema.index({ org: 1, project: 1, status: 1, order: 1 });
taskSchema.index({ org: 1, assignee: 1, status: 1 });
export const Task = model("Task", taskSchema);

/* --------------------------------- Comment --------------------------------- */
const commentSchema = new Schema(
  {
    org: ref("Organization", true),
    task: ref("Task", true),
    author: ref("User", true),
    body: { type: String, required: true },
    mentions: [ref("User")],
  },
  opts,
);
export const Comment = model("Comment", commentSchema);

/* -------------------------------- TimeEntry -------------------------------- */
const timeEntrySchema = new Schema(
  {
    org: ref("Organization", true),
    user: ref("User", true),
    task: ref("Task"),
    project: ref("Project", true),
    client: ref("Client"),
    description: String,
    startedAt: { type: Date, required: true },
    endedAt: Date, // null => timer still running
    minutes: { type: Number, default: 0 },
    billable: { type: Boolean, default: true },
    source: { type: String, enum: ["timer", "manual"], default: "manual" },
  },
  opts,
);
timeEntrySchema.index({ org: 1, user: 1, startedAt: -1 });
timeEntrySchema.index({ org: 1, client: 1, startedAt: -1 });
export const TimeEntry = model("TimeEntry", timeEntrySchema);

/* ------------------------------ Notification ------------------------------- */
const notificationSchema = new Schema(
  {
    org: ref("Organization", true),
    user: ref("User", true),
    type: { type: String, enum: ["assigned", "comment", "mention", "status", "due_soon", "system"], required: true },
    title: { type: String, required: true },
    body: String,
    link: String,
    read: { type: Boolean, default: false },
  },
  opts,
);
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
export const Notification = model("Notification", notificationSchema);

/* -------------------------------- Activity --------------------------------- */
const activitySchema = new Schema(
  {
    org: ref("Organization", true),
    actor: ref("User"),
    verb: { type: String, required: true }, // e.g. "task.moved", "comment.created"
    summary: { type: String, required: true },
    project: ref("Project"),
    task: ref("Task"),
    meta: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
activitySchema.index({ org: 1, createdAt: -1 });
export const Activity = model("Activity", activitySchema);

export type TaskDoc = InferSchemaType<typeof taskSchema> & { _id: Types.ObjectId };
export type ProjectDoc = InferSchemaType<typeof projectSchema> & { _id: Types.ObjectId };
