import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.ANTHROPIC_API_KEY = "";
delete process.env.MONGODB_URI;

const { connectDb, disconnectDb } = await import("../db.js");
const { createApp } = await import("../app.js");
const { seedDemo, DEMO_EMAIL, DEMO_PASSWORD } = await import("../seed.js");

before(async () => {
  await connectDb({ ephemeral: true });
  await seedDemo();
});
after(async () => disconnectDb());

test("demo seed is loginable and produces a populated dashboard", async () => {
  const app = createApp();
  const login = await request(app).post("/api/auth/login").send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, "admin");
  const dash = await request(app).get("/api/dashboard").set({ Authorization: `Bearer ${login.body.token}` });
  assert.equal(dash.body.workload.length, 5);
  assert.ok(dash.body.counts.activeProjects >= 4);
  assert.ok(dash.body.counts.overdueTasks > 0);
  assert.ok(dash.body.activity.length > 0);
  const report = await request(app).post("/api/ai/status-report").set({ Authorization: `Bearer ${login.body.token}` }).send({ project: dash.body.projects[0]._id });
  assert.equal(report.status, 200);
});
