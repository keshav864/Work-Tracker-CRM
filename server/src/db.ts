import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { config } from "./config.js";

type Embedded = { stop: () => Promise<boolean> };
let embedded: Embedded | null = null;

/**
 * Connects to MongoDB. Uses MONGODB_URI when set (local mongod, Docker or Atlas);
 * otherwise boots an embedded mongodb-memory-server so the app runs with zero setup.
 * The embedded server persists to `.data/mongo` unless `ephemeral` is true (tests).
 */
export async function connectDb(opts: { ephemeral?: boolean } = {}): Promise<{ uri: string; embedded: boolean }> {
  let uri = config.mongoUri;
  if (!uri) {
    // One shared binary cache for dev, tests and seed (first run downloads mongod, ~80 MB unpacked).
    process.env.MONGOMS_DOWNLOAD_DIR ??= path.resolve(config.embeddedDbPath, "../mongodb-binaries");
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const instance = opts.ephemeral
      ? {}
      : (fs.mkdirSync(config.embeddedDbPath, { recursive: true }),
        { dbPath: config.embeddedDbPath, storageEngine: "wiredTiger" as const });
    const server = await MongoMemoryServer.create({ instance });
    embedded = server;
    uri = server.getUri("work_tracker");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  return { uri: uri.replace(/\/\/[^@]*@/, "//***@"), embedded: !!embedded };
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (embedded) await embedded.stop();
  embedded = null;
}
