/**
 * Thin wrapper around the Anthropic SDK. Every AI feature calls `structured()` (Zod schema ->
 * guaranteed-valid JSON via structured outputs) or `complete()` (markdown text). When
 * ANTHROPIC_API_KEY is not set, callers use their heuristic fallback instead (see features.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "../config.js";

let _client: Anthropic | null = null;
function claude(): Anthropic {
  if (!config.anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set (demo mode)");
  _client ??= new Anthropic({ apiKey: config.anthropicKey, maxRetries: 3 });
  return _client;
}

/**
 * Shared request params. Server-side refusal fallbacks are on, so if a safety classifier declines
 * on the primary model the API transparently re-runs the request on a fallback model.
 */
const baseParams = () => ({
  model: config.model,
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
});

export async function structured<S extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<S>> {
  const res = await claude().beta.messages.parse({
    ...baseParams(),
    max_tokens: 16000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request");
  if (res.parsed_output == null) throw new Error(`No structured output (stop_reason: ${res.stop_reason})`);
  return res.parsed_output as z.infer<S>;
}

export async function complete(opts: { system: string; prompt: string; effort?: "low" | "medium" | "high" }): Promise<string> {
  const res = await claude().beta.messages.create({
    ...baseParams(),
    max_tokens: 16000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.prompt }],
    output_config: { effort: opts.effort ?? "medium" },
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request");
  return res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}

/** Turn SDK errors into short, user-safe messages (typed classes, most specific first). */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid ANTHROPIC_API_KEY";
  if (err instanceof Anthropic.RateLimitError) return "AI is rate limited — try again shortly";
  if (err instanceof Anthropic.BadRequestError) return `AI request rejected: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status ?? "network"})`;
  return err instanceof Error ? err.message : "AI request failed";
}
