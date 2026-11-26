import http from "node:http";
import { aiMode, config } from "./config.js";
import { connectDb, disconnectDb } from "./db.js";
import { createApp } from "./app.js";
import { attachRealtime } from "./realtime.js";
import { Organization, User } from "./models.js";
import { seedDemo } from "./seed.js";

const db = await connectDb();
console.log(`[db] connected ${db.embedded ? "(embedded mongodb-memory-server, data in .data/mongo)" : db.uri}`);

// First run with an empty database: load demo data so the app is explorable immediately.
if ((await User.countDocuments()) === 0 && (await Organization.countDocuments()) === 0 && process.env.AUTO_SEED !== "false") {
  await seedDemo();
  console.log("[db] seeded demo workspace — sign in as demo@worktracker.dev / demo1234");
}

const server = http.createServer(createApp());
attachRealtime(server);
server.listen(config.port, () => {
  console.log(`[api] http://localhost:${config.port}  ·  AI mode: ${aiMode()}${aiMode() === "demo" ? " (set ANTHROPIC_API_KEY for live Claude)" : ` (${config.model})`}`);
});

const shutdown = async () => {
  server.close();
  await disconnectDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
