/**
 * AI features. Each one runs on Claude when ANTHROPIC_API_KEY is set ("live") and falls back to a
 * deterministic heuristic otherwise ("demo"), so the app is fully usable without a key.
 */
import * as z from "zod/v4";
import { aiMode } from "../config.js";
import { addDays, DAY, isoDate, parseLocalDate, startOfDay, startOfWeek } from "../lib/dates.js";
import { Project, Task, TimeEntry, User, PRIORITIES } from "../models.js";
import { aiErrorMessage, complete, structured } from "./claude.js";

type Priority = (typeof PRIORITIES)[number];
export type AiResult<T> = T & { mode: "live" | "demo"; warning?: string };

async function run<T>(live: () => Promise<T>, demo: () => Promise<T> | T): Promise<AiResult<T>> {
  if (aiMode() === "live") {
    try {
      return { ...(await live()), mode: "live" };
    } catch (err) {
      // Never block the user on an AI outage: fall back and surface a warning.
      return { ...(await demo()), mode: "demo", warning: aiErrorMessage(err) };
    }
  }
  return { ...(await demo()), mode: "demo" };
}

/* ======================= 1. Natural-language task creation ======================= */

export interface TaskDraft {
  title: string;
  description?: string;
  priority: Priority;
  dueDate?: string; // YYYY-MM-DD
  estimateHours?: number;
  labels: string[];
  assigneeId?: string;
  assigneeName?: string;
  projectId?: string;
  projectName?: string;
}

const TaskDraftSchema = z.object({
  title: z.string().describe("Concise imperative task title, max ~80 chars, without date/assignee/priority words"),
  description: z.string().describe("Extra detail from the request, or empty string"),
  priority: z.enum(PRIORITIES),
  dueDate: z.string().describe("YYYY-MM-DD, or empty string if no due date was mentioned"),
  estimateHours: z.number().describe("Estimated hours if mentioned or clearly implied, else 0"),
  labels: z.array(z.string()).describe("0-3 short lowercase labels"),
  assigneeName: z.string().describe("Exact name of a team member from the list, or empty string"),
  projectName: z.string().describe("Exact name of a project from the list, or empty string"),
});

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function heuristicParseTask(
  text: string,
  team: { id: string; name: string }[],
  projects: { id: string; name: string; key: string }[],
  now = new Date(),
): TaskDraft {
  let rest = ` ${text.trim()} `;
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], " ");
    return m;
  };

  // priority
  let priority: Priority = "medium";
  if (take(/\b(urgent|asap|critical|p0|blocker)\b[!]*/i)) priority = "urgent";
  else if (take(/\b(high[- ]priority|important|p1)\b/i)) priority = "high";
  else if (take(/\b(low[- ]priority|whenever|nice to have|p3)\b/i)) priority = "low";

  // due date
  let due: Date | undefined;
  const today = startOfDay(now);
  let m: RegExpMatchArray | null;
  if ((m = take(/\b(?:by|on|due)?\s*(\d{4}-\d{2}-\d{2})\b/i))) due = parseLocalDate(m[1]);
  else if (take(/\b(?:by|due)?\s*(?:end of (?:the )?day|eod|today)\b/i)) due = today;
  else if (take(/\b(?:by|due)?\s*tomorrow\b/i)) due = addDays(today, 1);
  else if ((m = take(/\bin (\d+) days?\b/i))) due = addDays(today, Number(m[1]));
  else if (take(/\b(?:by|due)?\s*(?:end of (?:the )?week|eow)\b/i)) due = addDays(startOfWeek(now), 4);
  else if (take(/\b(?:by|due)?\s*next week\b/i)) due = addDays(startOfWeek(now), 7);
  else if ((m = take(/\b(?:by|on|due|before)?\s*(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    const target = WEEKDAYS.indexOf(m[1].toLowerCase());
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    due = addDays(today, diff);
  }

  // estimate: "2h", "3 hours", "30m"
  let estimateHours: number | undefined;
  if ((m = take(/(?:~\s*|\babout\s+|\bestimated?\s+(?:at\s+)?)?\b(\d+(?:\.\d+)?)\s*(h|hrs?|hours?)\b/i))) estimateHours = Number(m[1]);
  else if ((m = take(/(?:~\s*|\babout\s+)?\b(\d+)\s*(m|mins?|minutes?)\b/i))) estimateHours = Math.round((Number(m[1]) / 60) * 100) / 100;

  // labels: #tag
  const labels: string[] = [];
  for (const t of rest.matchAll(/#([\w-]+)/g)) labels.push(t[1].toLowerCase());
  rest = rest.replace(/#[\w-]+/g, " ");

  // assignee: "@sam", "for Sam", "assign to Sam"
  let assignee: { id: string; name: string } | undefined;
  for (const u of team) {
    const first = u.name.split(" ")[0];
    const re = new RegExp(`(?:@|\\b(?:assign(?:ed)? to|for|ask)\\s+)(${escapeRe(u.name)}|${escapeRe(first)})\\b`, "i");
    if (take(re)) {
      assignee = u;
      break;
    }
  }

  // project: match by key ("[WEB]" / "WEB:") or name ("in Website Redesign")
  let project: { id: string; name: string } | undefined;
  for (const p of projects) {
    const re = new RegExp(`(?:\\[${escapeRe(p.key)}\\]|\\b${escapeRe(p.key)}:|\\b(?:in|for|on)\\s+(?:the\\s+)?${escapeRe(p.name)}(?:\\s+project)?\\b)`, "i");
    if (take(re)) {
      project = p;
      break;
    }
  }

  const title = rest
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!])/g, "$1")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .replace(/^(please|pls|can you|could you|we need to|need to|todo:?)\s+/i, "")
    .trim();

  return {
    title: title ? title[0].toUpperCase() + title.slice(1) : text.trim(),
    priority,
    dueDate: due ? isoDate(due) : undefined,
    estimateHours,
    labels,
    assigneeId: assignee?.id,
    assigneeName: assignee?.name,
    projectId: project?.id,
    projectName: project?.name,
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function parseTask(org: string, text: string, defaultProjectId?: string) {
  const [teamDocs, projectDocs] = await Promise.all([
    User.find({ org, active: true }).select("name").lean(),
    Project.find({ org, status: { $nin: ["archived", "completed"] } }).select("name key").lean(),
  ]);
  const team = teamDocs.map((u) => ({ id: String(u._id), name: u.name }));
  const projects = projectDocs.map((p) => ({ id: String(p._id), name: p.name, key: p.key }));
  const withDefault = (d: TaskDraft): TaskDraft =>
    d.projectId || !defaultProjectId ? d : { ...d, projectId: defaultProjectId, projectName: projects.find((p) => p.id === defaultProjectId)?.name };

  return run(
    async () => {
      const today = new Date();
      const out = await structured({
        system:
          "You turn a one-line request from a project team into a structured task for a work tracker. " +
          "Only use team member and project names from the lists provided; leave fields empty when not stated. " +
          "Resolve relative dates (\"Friday\", \"next week\") against today's date.",
        prompt:
          `Today is ${isoDate(today)} (${WEEKDAYS[today.getDay()]}).\n` +
          `Team members: ${team.map((t) => t.name).join(", ")}\n` +
          `Projects: ${projects.map((p) => `${p.name} [${p.key}]`).join(", ")}\n\nRequest: ${text}`,
        schema: TaskDraftSchema,
      });
      const assignee = team.find((t) => t.name.toLowerCase() === out.assigneeName.toLowerCase());
      const project = projects.find((p) => p.name.toLowerCase() === out.projectName.toLowerCase());
      return withDefault({
        title: out.title,
        description: out.description || undefined,
        priority: out.priority,
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(out.dueDate) ? out.dueDate : undefined,
        estimateHours: out.estimateHours > 0 ? out.estimateHours : undefined,
        labels: out.labels.slice(0, 3),
        assigneeId: assignee?.id,
        assigneeName: assignee?.name,
        projectId: project?.id,
        projectName: project?.name,
      });
    },
    () => withDefault(heuristicParseTask(text, team, projects)),
  );
}

/* ============================ 2. Task breakdown ============================ */

const BreakdownSchema = z.object({
  subtasks: z.array(z.string()).describe("4-8 concrete, verb-first subtasks that together complete the task"),
});

const TEMPLATES: { match: RegExp; steps: string[] }[] = [
  { match: /\b(bug|fix|error|crash|broken|issue)\b/i, steps: ["Reproduce the issue and capture steps", "Identify the root cause", "Implement the fix", "Add a regression test", "Verify on staging", "Deploy and confirm with the reporter"] },
  { match: /\b(design|mockup|wireframe|ui|ux|logo|brand)\b/i, steps: ["Collect requirements and references", "Sketch low-fidelity wireframes", "Create high-fidelity designs", "Review with stakeholders", "Apply feedback and finalize", "Hand off assets to development"] },
  { match: /\b(api|endpoint|integration|backend|webhook|database|migration)\b/i, steps: ["Define the contract and data model", "Implement the endpoint/logic", "Add validation and error handling", "Write automated tests", "Document the API", "Deploy and monitor"] },
  { match: /\b(page|landing|website|frontend|component|screen)\b/i, steps: ["Confirm content and design", "Build the layout and components", "Wire up data and interactions", "Make it responsive and accessible", "Cross-browser QA", "Publish and verify analytics"] },
  { match: /\b(report|analysis|audit|research|review)\b/i, steps: ["Define scope and questions", "Gather the data", "Analyse findings", "Draft the report", "Review with the team", "Present to the client"] },
  { match: /\b(launch|release|campaign|email|newsletter|social)\b/i, steps: ["Define goals and audience", "Draft copy and creatives", "Get approvals", "Schedule and set up tracking", "Launch", "Report on results"] },
  { match: /\b(meeting|workshop|onboarding|kickoff|training)\b/i, steps: ["Agree date and attendees", "Prepare agenda and materials", "Run the session", "Share notes and action items", "Follow up on open questions"] },
];

export async function breakdownTask(taskId: string, org: string) {
  const task = await Task.findOne({ _id: taskId, org }).populate("project", "name description").lean();
  if (!task) throw new Error("Task not found");
  const project = task.project as unknown as { name: string; description?: string } | null;
  return run(
    async () => {
      const out = await structured({
        system: "You are a senior delivery lead. Break work items into a short checklist of concrete subtasks a teammate could tick off. Skip anything already done.",
        prompt: `Project: ${project?.name ?? "-"}\nTask: ${task.title}\nDescription: ${task.description ?? "-"}\nExisting subtasks: ${task.subtasks?.map((s) => s.title).join("; ") || "none"}`,
        schema: BreakdownSchema,
      });
      return { subtasks: out.subtasks.slice(0, 8) };
    },
    () => {
      const text = `${task.title} ${task.description ?? ""}`;
      const tpl = TEMPLATES.find((t) => t.match.test(text));
      const steps = tpl?.steps ?? ["Clarify requirements and acceptance criteria", "Plan the approach", "Do the work", "Self-review and test", "Get review / client approval", "Deliver and close out"];
      const existing = new Set((task.subtasks ?? []).map((s) => s.title.toLowerCase()));
      return { subtasks: steps.filter((s) => !existing.has(s.toLowerCase())) };
    },
  );
}

/* =========================== 3. Effort estimation =========================== */

const EstimateSchema = z.object({
  hours: z.number().describe("Best estimate of total hours"),
  low: z.number(),
  high: z.number(),
  confidence: z.enum(["low", "medium", "high"]),
  rationale: z.string().describe("2-3 sentences explaining the estimate"),
});

/** Average actual hours of completed tasks in the same project that share a label (historical signal). */
async function historicalHours(task: { org: unknown; project: unknown; labels?: string[] | null; _id: unknown }) {
  const filter: Record<string, unknown> = {
    org: task.org,
    project: task.project,
    status: "done",
    _id: { $ne: task._id },
    ...(task.labels?.length ? { labels: { $in: task.labels } } : {}),
  };
  const similar = await Task.find(filter)
    .select("_id title")
    .limit(30)
    .lean();
  if (!similar.length) return null;
  const agg = await TimeEntry.aggregate<{ _id: unknown; minutes: number }>([
    { $match: { task: { $in: similar.map((s) => s._id) } } },
    { $group: { _id: "$task", minutes: { $sum: "$minutes" } } },
  ]);
  if (!agg.length) return null;
  const avg = agg.reduce((a, b) => a + b.minutes, 0) / agg.length / 60;
  return { avgHours: Math.round(avg * 10) / 10, sample: agg.length, titles: similar.slice(0, 5).map((s) => s.title) };
}

export async function estimateTask(taskId: string, org: string) {
  const task = await Task.findOne({ _id: taskId, org }).lean();
  if (!task) throw new Error("Task not found");
  const hist = await historicalHours(task);
  return run(
    async () =>
      structured({
        system: "You estimate effort for agency/client work. Be realistic, include review and QA time, and use historical data when given.",
        prompt:
          `Task: ${task.title}\nDescription: ${task.description ?? "-"}\nPriority: ${task.priority}\nLabels: ${task.labels?.join(", ") || "-"}\n` +
          `Subtasks: ${task.subtasks?.map((s) => s.title).join("; ") || "none"}\n` +
          (hist ? `Historical: ${hist.sample} similar completed tasks averaged ${hist.avgHours}h (e.g. ${hist.titles.join("; ")}).` : "No historical data."),
        schema: EstimateSchema,
      }),
    () => {
      const words = `${task.title} ${task.description ?? ""}`.split(/\s+/).length;
      const subs = task.subtasks?.length ?? 0;
      let base = 2 + Math.min(words, 80) / 20 + subs * 1.25;
      if (/\b(bug|fix|typo|copy)\b/i.test(task.title)) base *= 0.6;
      if (/\b(design|build|implement|integrat|migrat|redesign)\b/i.test(task.title)) base *= 1.5;
      if (task.priority === "urgent") base *= 1.1;
      let hours = base;
      let rationale = `Based on scope (${words} words of description, ${subs} subtasks) and the type of work.`;
      if (hist) {
        hours = (base + hist.avgHours * 2) / 3;
        rationale += ` Blended with ${hist.sample} similar completed tasks in this project that took ${hist.avgHours}h on average.`;
      }
      const h = Math.max(0.5, Math.round(hours * 2) / 2);
      return { hours: h, low: Math.max(0.5, Math.round(h * 0.7 * 2) / 2), high: Math.round(h * 1.5 * 2) / 2, confidence: (hist ? "medium" : "low") as "low" | "medium" | "high", rationale };
    },
  );
}

/* ======================== 4. Weekly project status report ======================== */

export async function projectStats(projectId: string, org: string, now = new Date()) {
  const project = await Project.findOne({ _id: projectId, org }).populate("client", "name").lean();
  if (!project) throw new Error("Project not found");
  const weekStart = startOfWeek(now);
  const nextWeek = addDays(startOfDay(now), 7);
  const tasks = await Task.find({ org, project: projectId }).populate("assignee", "name").lean();
  const byStatus = Object.fromEntries(["backlog", "todo", "in_progress", "review", "done"].map((s) => [s, 0])) as Record<string, number>;
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const name = (t: (typeof tasks)[number]) => (t.assignee as unknown as { name?: string } | null)?.name ?? "Unassigned";
  const summarize = (t: (typeof tasks)[number]) => ({ title: `${project.key}-${t.number} ${t.title}`, assignee: name(t), due: t.dueDate ? isoDate(t.dueDate) : null, priority: t.priority });

  const completedThisWeek = tasks.filter((t) => t.status === "done" && t.completedAt && t.completedAt >= weekStart).map(summarize);
  const inProgress = tasks.filter((t) => t.status === "in_progress" || t.status === "review").map(summarize);
  const overdue = tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < startOfDay(now)).map(summarize);
  const upcoming = tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate >= startOfDay(now) && t.dueDate <= nextWeek).map(summarize);
  const [hoursAgg] = await TimeEntry.aggregate<{ total: number; week: number; billable: number }>([
    { $match: { project: project._id } },
    {
      $group: {
        _id: null,
        total: { $sum: "$minutes" },
        week: { $sum: { $cond: [{ $gte: ["$startedAt", weekStart] }, "$minutes", 0] } },
        billable: { $sum: { $cond: ["$billable", "$minutes", 0] } },
      },
    },
  ]);
  const h = (m = 0) => Math.round((m / 60) * 10) / 10;
  const total = tasks.length;
  return {
    project: { name: project.name, key: project.key, client: (project.client as unknown as { name?: string } | null)?.name ?? null, dueDate: project.dueDate ? isoDate(project.dueDate) : null, budgetHours: project.budgetHours ?? null },
    weekOf: isoDate(weekStart),
    progressPct: total ? Math.round((byStatus.done / total) * 100) : 0,
    byStatus,
    totalTasks: total,
    hours: { total: h(hoursAgg?.total), thisWeek: h(hoursAgg?.week), billable: h(hoursAgg?.billable) },
    completedThisWeek,
    inProgress,
    overdue,
    upcoming,
    daysToDeadline: project.dueDate ? Math.ceil((project.dueDate.getTime() - now.getTime()) / DAY) : null,
  };
}

export function heuristicReport(s: Awaited<ReturnType<typeof projectStats>>): string {
  const burn = s.project.budgetHours ? Math.round((s.hours.total / s.project.budgetHours) * 100) : null;
  let health: "🟢 On track" | "🟡 At risk" | "🔴 Off track" = "🟢 On track";
  if (s.overdue.length >= 3 || (burn !== null && burn > s.progressPct + 25)) health = "🔴 Off track";
  else if (s.overdue.length > 0 || (burn !== null && burn > s.progressPct + 10) || (s.daysToDeadline !== null && s.daysToDeadline < 7 && s.progressPct < 80)) health = "🟡 At risk";
  const list = (xs: { title: string; assignee: string; due: string | null }[], empty: string) =>
    xs.length ? xs.slice(0, 8).map((x) => `- ${x.title} — ${x.assignee}${x.due ? ` (due ${x.due})` : ""}`).join("\n") : `- ${empty}`;
  return [
    `## ${s.project.name} — weekly status (week of ${s.weekOf})`,
    `**Health:** ${health} · **Progress:** ${s.progressPct}% (${s.byStatus.done}/${s.totalTasks} tasks done)` + (s.project.client ? ` · **Client:** ${s.project.client}` : ""),
    `**Hours:** ${s.hours.thisWeek}h this week · ${s.hours.total}h total` + (s.project.budgetHours ? ` of ${s.project.budgetHours}h budget (${burn}% burned)` : "") + (s.daysToDeadline !== null ? ` · **Deadline:** ${s.project.dueDate} (${s.daysToDeadline} days)` : ""),
    `### ✅ Completed this week\n${list(s.completedThisWeek, "Nothing completed yet this week")}`,
    `### 🔄 In progress\n${list(s.inProgress, "No tasks in progress")}`,
    `### ⚠️ Risks & blockers\n${s.overdue.length ? list(s.overdue, "") : "- No overdue tasks"}` + (burn !== null && burn > s.progressPct + 10 ? `\n- Budget burn (${burn}%) is ahead of progress (${s.progressPct}%)` : ""),
    `### 📅 Next 7 days\n${list(s.upcoming, "No deadlines in the next 7 days")}`,
  ].join("\n\n");
}

export async function statusReport(projectId: string, org: string) {
  const stats = await projectStats(projectId, org);
  return run(
    async () => ({
      markdown: await complete({
        system:
          "You write concise weekly client-facing project status reports in Markdown. Start with a `## <Project> — weekly status` heading, " +
          "then a one-line health verdict (🟢 On track / 🟡 At risk / 🔴 Off track) with a short reason, then sections: Completed this week, In progress, Risks & blockers, Next 7 days. " +
          "Use only the facts in the JSON; do not invent tasks. Keep it under 300 words.",
        prompt: `Project data (JSON):\n${JSON.stringify(stats, null, 2)}`,
      }),
      stats,
    }),
    () => ({ markdown: heuristicReport(stats), stats }),
  );
}
