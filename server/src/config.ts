import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 4100),
  /** Real MongoDB / Atlas URI. When unset, an embedded mongodb-memory-server is started automatically. */
  mongoUri: process.env.MONGODB_URI ?? "",
  /** Where the embedded dev database keeps its files so data survives restarts. */
  embeddedDbPath: process.env.EMBEDDED_DB_PATH ?? path.resolve(here, "../../.data/mongo"),
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5174",
  isProd: process.env.NODE_ENV === "production",
};

export const aiMode = (): "live" | "demo" => (config.anthropicKey ? "live" : "demo");
