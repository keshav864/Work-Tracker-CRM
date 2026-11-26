/**
 * API integration tests against an ephemeral in-memory MongoDB (no setup needed).
 * Run: npm test
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// Force deterministic demo-mode AI and an ephemeral DB before any app module loads config.
process.env.ANTHROPIC_API_KEY = "";
delete process.env.MONGODB_URI;

const { connectDb, disconnectDb } = await import("../db.js");
const { createApp } = await import("../app.js");
const { heuristicParseTask } = await import("../ai/features.js");
const { isoDate, startOfWeek, addDays } = await import("../lib/dates.js");

const app = createApp();
let adminToken = "";
let memberToken = "";
let memberId = "";
let projectId = "";
let clientId = "";
let taskId = "";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

before(async () => {
  await connectDb({ ephemeral: true });
});
after(async () => {
  await disconnectDb();
});

describe("auth & roles", () => {
  test("register creates a workspace with an admin", async () => {
    const res = await request(app).post("/api/auth/register").send({ name: "Ada Admin", email: "ada@test.dev", password: "password123", organization: "Test Co" });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, "admin");
    assert.ok(res.body.token);
    adminToken = res.body.token;
  });

  test("login rejects a wrong password and accepts the right one", async () => {
    const bad = await request(app).post("/api/auth/login").send({ email: "ada@test.dev", password: "nope" });
    assert.equal(bad.status, 401);
    const ok = await request(app).post("/api/auth/login").send({ email: "ADA@test.dev", password: "password123" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.name, "Ada Admin");
  });

  test("protected routes require a token", async () => {
    assert.equal((await request(app).get("/api/projects")).status, 401);
  });

  test("admin adds a member; member cannot create projects", async () => {
    const res = await request(app).post("/api/users").set(auth(adminToken)).send({ name: "Mo Member", email: "mo@test.dev", password: "password123", role: "member" });
    assert.equal(res.status, 201);
    memberId = res.body._id;
    memberToken = (await request(app).post("/api/auth/login").send({ email: "mo@test.dev", password: "password123" })).body.token;
    const denied = await request(app).post("/api/projects").set(auth(memberToken)).send({ name: "Nope" });
    assert.equal(denied.status, 403);
  });

  test("validation errors return 400 with field details", async () => {
    const res = await request(app).post("/api/clients").set(auth(adminToken)).send({ name: "" });
    assert.equal(res.status, 400);
    assert.equal(res.body.details[0].path, "name");
  });
});

describe("clients, projects & tasks", () => {
  test("create client and project with an auto-generated key", async () => {
    const c = await request(app).post("/api/clients").set(auth(adminToken)).send({ name: "Globex", hourlyRate: 100 });
    assert.equal(c.status, 201);
    clientId = c.body._id;
    const p = await request(app).post("/api/projects").set(auth(adminToken)).send({ name: "Launch Site", client: clientId, members: [memberId] });
    assert.equal(p.status, 201);
    assert.equal(p.body.key, "LS");
    projectId = p.body._id;
  });

  test("tasks get sequential numbers and notify the assignee", async () => {
    const t1 = await request(app).post("/api/tasks").set(auth(adminToken)).send({ project: projectId, title: "Build hero", assignee: memberId, priority: "high" });
    const t2 = await request(app).post("/api/tasks").set(auth(adminToken)).send({ project: projectId, title: "Write copy" });
    assert.equal(t1.status, 201);
    assert.equal(t1.body.number, 1);
    assert.equal(t2.body.number, 2);
    taskId = t1.body._id;
    const notes = await request(app).get("/api/notifications").set(auth(memberToken));
    assert.equal(notes.body.unread, 1);
    assert.match(notes.body.items[0].title, /assigned you LS-1/);
  });

  test("moving a task to done records completion and progress", async () => {
    const res = await request(app).post(`/api/tasks/${taskId}/move`).set(auth(memberToken)).send({ status: "done", order: 500 });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "done");
    assert.ok(res.body.completedAt);
    const p = await request(app).get(`/api/projects/${projectId}`).set(auth(adminToken));
    assert.equal(p.body.progress, 50);
    const activity = await request(app).get(`/api/activity?project=${projectId}`).set(auth(adminToken));
    assert.ok(activity.body.some((a: { verb: string }) => a.verb === "task.moved"));
  });

  test("subtasks and @mention comments", async () => {
    const s = await request(app).post(`/api/tasks/${taskId}/subtasks`).set(auth(adminToken)).send({ titles: ["A", "B"] });
    assert.equal(s.body.subtasks.length, 2);
    const c = await request(app).post(`/api/tasks/${taskId}/comments`).set(auth(adminToken)).send({ body: "Nice work @Mo!" });
    assert.equal(c.status, 201);
    assert.deepEqual(c.body.mentions, [memberId]);
    const notes = await request(app).get("/api/notifications").set(auth(memberToken));
    assert.ok(notes.body.items.some((n: { type: string }) => n.type === "mention"));
  });
});

describe("time tracking, timesheets & invoices", () => {
  test("timer start/stop creates one running entry at a time", async () => {
    const start = await request(app).post("/api/time/start").set(auth(memberToken)).send({ task: taskId });
    assert.equal(start.status, 201);
    const current = await request(app).get("/api/time/current").set(auth(memberToken));
    assert.equal(current.body._id, start.body._id);
    const stop = await request(app).post("/api/time/stop").set(auth(memberToken));
    assert.equal(stop.status, 200);
    assert.ok(stop.body.minutes >= 1);
    assert.equal((await request(app).get("/api/time/current").set(auth(memberToken))).body, null);
  });

  test("manual entries roll up into the weekly timesheet", async () => {
    const monday = startOfWeek(new Date());
    await request(app).post("/api/time").set(auth(memberToken)).send({ task: taskId, date: isoDate(monday), minutes: 120 });
    await request(app).post("/api/time").set(auth(memberToken)).send({ project: projectId, date: isoDate(addDays(monday, 1)), minutes: 60, billable: false });
    const ts = await request(app).get(`/api/time/timesheet?week=${isoDate(monday)}`).set(auth(memberToken));
    assert.equal(ts.status, 200);
    assert.ok(ts.body.dayTotals[0] >= 120);
    assert.equal(ts.body.dayTotals[1], 60);
    assert.ok(ts.body.nonBillableMinutes >= 60);
  });

  test("members can't read other people's timesheets", async () => {
    const meRes = await request(app).get("/api/auth/me").set(auth(adminToken));
    const res = await request(app).get(`/api/time/timesheet?user=${meRes.body.user._id}`).set(auth(memberToken));
    assert.equal(res.status, 403);
  });

  test("invoice prices billable hours with the client rate", async () => {
    const monday = startOfWeek(new Date());
    const res = await request(app).get(`/api/time/invoice?client=${clientId}&from=${isoDate(addDays(monday, -1))}&to=${isoDate(addDays(monday, 7))}`).set(auth(adminToken));
    assert.equal(res.status, 200);
    const line = res.body.lines.find((l: { person: string }) => l.person === "Mo Member");
    assert.equal(line.rate, 100);
    assert.ok(line.billableHours >= 2);
    assert.equal(res.body.subtotal, Math.round(res.body.lines.reduce((a: number, l: { amount: number }) => a + l.amount, 0) * 100) / 100);
    assert.equal((await request(app).get(`/api/time/invoice?client=${clientId}`).set(auth(memberToken))).status, 403);
  });
});

describe("dashboard & AI (demo mode)", () => {
  test("dashboard aggregates workload and hours", async () => {
    const res = await request(app).get("/api/dashboard").set(auth(adminToken));
    assert.equal(res.status, 200);
    const mo = res.body.workload.find((w: { user: { name: string } }) => w.user.name === "Mo Member");
    assert.ok(mo.loggedHours >= 3);
    assert.equal(res.body.hoursThisWeek.byDay.length, 7);
  });

  test("natural-language task parsing (heuristic)", () => {
    const now = new Date(2026, 10, 25); // Wed 25 Nov 2026
    const d = heuristicParseTask("Urgent: fix checkout bug for Mo by Friday #payments ~3h in Launch Site", [{ id: "u1", name: "Mo Member" }], [{ id: "p1", name: "Launch Site", key: "LS" }], now);
    assert.equal(d.priority, "urgent");
    assert.equal(d.dueDate, "2026-11-27");
    assert.equal(d.assigneeId, "u1");
    assert.equal(d.projectId, "p1");
    assert.equal(d.estimateHours, 3);
    assert.deepEqual(d.labels, ["payments"]);
    assert.equal(d.title, "Fix checkout bug");
  });

  test("AI endpoints fall back to demo mode without an API key", async () => {
    const parsed = await request(app).post("/api/ai/parse-task").set(auth(adminToken)).send({ text: "Write launch email tomorrow", project: projectId });
    assert.equal(parsed.body.mode, "demo");
    assert.equal(parsed.body.projectId, projectId);
    const bd = await request(app).post("/api/ai/breakdown").set(auth(adminToken)).send({ task: taskId });
    assert.ok(bd.body.subtasks.length >= 3);
    const est = await request(app).post("/api/ai/estimate").set(auth(adminToken)).send({ task: taskId });
    assert.ok(est.body.hours > 0 && est.body.low <= est.body.hours && est.body.hours <= est.body.high);
    const rep = await request(app).post("/api/ai/status-report").set(auth(adminToken)).send({ project: projectId });
    assert.match(rep.body.markdown, /Launch Site — weekly status/);
  });
});
