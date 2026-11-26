/**
 * Demo data: a small agency ("Northwind Studio") with 5 teammates, 4 clients, 5 projects,
 * ~45 tasks across the Kanban, three weeks of time entries, comments, notifications and activity.
 *
 *   npm run seed   → wipes the database and re-seeds (stop `npm run dev` first when using the embedded DB)
 *
 * Every demo user's password is `demo1234`; the admin is demo@worktracker.dev.
 */
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { addDays, startOfDay } from "./lib/dates.js";
import { Activity, Client, Comment, Contact, Notification, Organization, Project, Task, TimeEntry, User } from "./models.js";

export const DEMO_EMAIL = "demo@worktracker.dev";
export const DEMO_PASSWORD = "demo1234";

/** Small deterministic PRNG so the demo looks the same every time. */
function rng(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

export async function seedDemo() {
  const rand = rng();
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const today = startOfDay(new Date());
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const org = await Organization.create({ name: "Northwind Studio", slug: "northwind-studio", currency: "USD", defaultHourlyRate: 110 });
  const mk = (name: string, email: string, role: "admin" | "manager" | "member", title: string, avatarColor: string, hourlyRate: number, weeklyCapacity = 40) =>
    User.create({ org: org._id, name, email, role, title, avatarColor, hourlyRate, weeklyCapacity, passwordHash });
  const [alex, priya, sam, diego, mia] = await Promise.all([
    mk("Alex Morgan", DEMO_EMAIL, "admin", "Founder & Delivery Lead", "#6366f1", 160),
    mk("Priya Shah", "priya@worktracker.dev", "manager", "Project Manager", "#ec4899", 130),
    mk("Sam Lee", "sam@worktracker.dev", "member", "Product Designer", "#f59e0b", 115, 32),
    mk("Diego Ramirez", "diego@worktracker.dev", "member", "Full-stack Engineer", "#10b981", 125),
    mk("Mia Chen", "mia@worktracker.dev", "member", "Frontend Engineer", "#0ea5e9", 120),
  ]);
  const team = [alex, priya, sam, diego, mia];

  /* clients + contacts */
  const [acme, bluepeak, lumen, greenleaf] = await Client.insertMany([
    { org: org._id, name: "Acme Retail", industry: "E-commerce", website: "https://acme.example", status: "active", hourlyRate: 120, owner: priya._id, notes: "Q4 is peak season — no deploys after Nov 20." },
    { org: org._id, name: "Bluepeak Health", industry: "Healthcare", website: "https://bluepeak.example", status: "active", hourlyRate: 140, owner: alex._id, notes: "HIPAA: no real patient data in staging." },
    { org: org._id, name: "Lumen Finance", industry: "Fintech", website: "https://lumen.example", status: "active", owner: priya._id },
    { org: org._id, name: "Greenleaf Co", industry: "Consumer goods", website: "https://greenleaf.example", status: "lead", owner: alex._id, notes: "Intro call went well; proposal due next week." },
  ]);
  await Contact.insertMany([
    { org: org._id, client: acme._id, name: "Jordan Blake", email: "jordan@acme.example", phone: "+1 415 555 0101", title: "Head of Digital", isPrimary: true },
    { org: org._id, client: acme._id, name: "Casey Ng", email: "casey@acme.example", title: "Marketing Manager" },
    { org: org._id, client: bluepeak._id, name: "Dr. Elena Ruiz", email: "elena@bluepeak.example", phone: "+1 617 555 0144", title: "CTO", isPrimary: true },
    { org: org._id, client: lumen._id, name: "Marcus Webb", email: "marcus@lumen.example", title: "Brand Director", isPrimary: true },
    { org: org._id, client: greenleaf._id, name: "Hannah Ito", email: "hannah@greenleaf.example", title: "COO", isPrimary: true },
  ]);

  /* projects */
  const P = (o: Record<string, unknown>) => ({ org: org._id, owner: priya._id, status: "active", billable: true, ...o });
  const [web, app, portal, brand, ops] = await Project.insertMany([
    P({ client: acme._id, name: "Website Redesign", key: "WEB", color: "#6366f1", description: "Replatform acme.example to a headless storefront with a new design system.", startDate: addDays(today, -40), dueDate: addDays(today, 24), budgetHours: 320, members: [priya._id, sam._id, diego._id, mia._id] }),
    P({ client: acme._id, name: "Mobile App MVP", key: "APP", color: "#0ea5e9", description: "Loyalty app for iOS/Android: rewards, order history, push offers.", startDate: addDays(today, -14), dueDate: addDays(today, 60), budgetHours: 480, members: [priya._id, diego._id, mia._id], status: "active" }),
    P({ client: bluepeak._id, name: "Patient Portal", key: "PORT", color: "#10b981", description: "Appointment booking, secure messaging and lab results for Bluepeak patients.", startDate: addDays(today, -55), dueDate: addDays(today, 5), budgetHours: 260, hourlyRate: 150, members: [alex._id, diego._id, sam._id], owner: alex._id }),
    P({ client: lumen._id, name: "Brand Refresh", key: "BRND", color: "#f59e0b", description: "New visual identity, guidelines and marketing site refresh.", startDate: addDays(today, -21), dueDate: addDays(today, 35), budgetHours: 140, members: [sam._id, priya._id] }),
    P({ name: "Internal Ops", key: "OPS", color: "#64748b", description: "Hiring, tooling and internal process work.", billable: false, members: team.map((u) => u._id), owner: alex._id }),
  ]);

  /* tasks */
  type Spec = [project: typeof web, title: string, status: string, priority: string, assignee: typeof alex | null, dueIn: number | null, est: number | null, labels: string[], subtasks?: [string, boolean][], description?: string];
  const specs: Spec[] = [
    [web, "Design system tokens & typography", "done", "high", sam, -20, 12, ["design"], [["Color palette", true], ["Type scale", true], ["Spacing tokens", true]]],
    [web, "Homepage hero and navigation", "done", "high", mia, -12, 10, ["frontend"]],
    [web, "Product listing page with filters", "review", "high", mia, 2, 16, ["frontend"], [["Filter sidebar", true], ["Sort dropdown", true], ["Infinite scroll", false]]],
    [web, "Cart & checkout flow integration with Stripe", "in_progress", "urgent", diego, 4, 20, ["backend", "payments"], [["Create PaymentIntent endpoint", true], ["Webhook handler", false], ["Order confirmation email", false]], "Use Stripe test keys in staging. Must support Apple Pay."],
    [web, "Migrate 1,200 product records from Magento", "in_progress", "high", diego, -2, 14, ["backend", "migration"]],
    [web, "Accessibility audit (WCAG 2.2 AA)", "todo", "medium", sam, 9, 8, ["qa", "design"]],
    [web, "SEO redirects map for old URLs", "todo", "medium", mia, -1, 6, ["seo"]],
    [web, "Fix mobile menu not closing on route change", "todo", "low", mia, 6, 2, ["bug", "frontend"]],
    [web, "Performance budget & Lighthouse CI", "backlog", "medium", null, null, 6, ["frontend"]],
    [web, "Blog CMS integration", "backlog", "low", null, null, 10, ["backend"]],
    [web, "Client UAT session", "todo", "high", priya, 16, 3, ["meeting"]],
    [app, "User research interviews (6 customers)", "done", "high", sam, -6, 10, ["research"]],
    [app, "App architecture & tech stack decision", "done", "high", diego, -8, 6, ["backend"]],
    [app, "Auth: email magic link + Apple/Google sign-in", "in_progress", "high", diego, 6, 16, ["backend", "auth"]],
    [app, "Rewards wallet screen", "todo", "medium", mia, 12, 12, ["frontend", "mobile"]],
    [app, "Push notification service", "todo", "medium", diego, 18, 10, ["backend", "mobile"]],
    [app, "Order history API", "backlog", "medium", null, 25, 8, ["backend"]],
    [app, "Onboarding flow designs", "review", "high", sam, 1, 12, ["design", "mobile"]],
    [app, "App store listing copy & screenshots", "backlog", "low", null, null, 4, ["marketing"]],
    [portal, "Appointment booking calendar", "done", "urgent", diego, -9, 24, ["backend", "frontend"]],
    [portal, "Secure messaging between patients and clinicians", "review", "urgent", diego, -1, 30, ["backend", "security"], [["E2E encryption", true], ["Read receipts", true], ["Attachment scanning", false]]],
    [portal, "Lab results viewer", "in_progress", "high", sam, 3, 14, ["frontend"]],
    [portal, "HIPAA security review & pen test fixes", "todo", "urgent", alex, -3, 12, ["security", "qa"], [], "Pen test report from Oct identified 3 medium findings."],
    [portal, "Load test booking API (500 rps)", "todo", "high", diego, 2, 6, ["qa", "backend"]],
    [portal, "Go-live checklist and runbook", "todo", "high", alex, 4, 4, ["ops"]],
    [portal, "Patient onboarding emails", "done", "medium", sam, -15, 5, ["marketing"]],
    [brand, "Brand workshop with Lumen leadership", "done", "high", priya, -14, 4, ["meeting"]],
    [brand, "Moodboards & creative directions (3 routes)", "done", "high", sam, -8, 12, ["design"]],
    [brand, "Logo exploration round 2", "in_progress", "high", sam, 5, 16, ["design"]],
    [brand, "Brand guidelines PDF", "todo", "medium", sam, 20, 14, ["design"]],
    [brand, "Marketing site page templates", "backlog", "medium", null, 30, 18, ["frontend"]],
    [brand, "Present final identity to stakeholders", "todo", "high", priya, 22, 3, ["meeting"]],
    [ops, "Hire senior backend engineer", "in_progress", "high", alex, 21, 10, ["hiring"]],
    [ops, "Quarterly planning & capacity review", "todo", "medium", priya, 7, 4, ["planning"]],
    [ops, "Renew design tool licenses", "todo", "low", priya, -4, 1, ["admin"]],
    [ops, "Write proposal for Greenleaf Co", "in_progress", "urgent", alex, 3, 6, ["sales"]],
    [ops, "Team offsite planning", "backlog", "low", null, null, 4, ["culture"]],
  ];
  const seq = new Map<string, number>();
  const orderIn = new Map<string, number>();
  const taskDocs = specs.map(([project, title, status, priority, assignee, dueIn, est, labels, subtasks, description]) => {
    const pk = String(project._id);
    const n = (seq.get(pk) ?? 0) + 1;
    seq.set(pk, n);
    const ok = `${pk}:${status}`;
    const order = (orderIn.get(ok) ?? 0) + 1000;
    orderIn.set(ok, order);
    const due = dueIn === null ? undefined : addDays(today, dueIn);
    return {
      org: org._id,
      project: project._id,
      number: n,
      title,
      description,
      status,
      priority,
      order,
      assignee: assignee?._id,
      reporter: pick([priya, alex])._id,
      dueDate: due,
      estimateHours: est ?? undefined,
      labels,
      subtasks: (subtasks ?? []).map(([t, done]) => ({ title: t, done })),
      completedAt: status === "done" ? addDays(today, Math.min(-1, (dueIn ?? -3) + 1)) : undefined,
      attachments: title.includes("guidelines") || title.includes("HIPAA") ? [{ name: title.includes("HIPAA") ? "pentest-report-oct.pdf" : "brand-guidelines-v1.pdf", size: 2_400_000, mimeType: "application/pdf", uploadedBy: priya._id }] : [],
    };
  });
  const tasks = await Task.insertMany(taskDocs);
  await Promise.all([...seq].map(([pid, n]) => Project.updateOne({ _id: pid }, { taskSeq: n })));

  /* time entries: last 3 weeks, weekdays, each person 3-4 entries/day on their tasks */
  const projClient = new Map([web, app, portal, brand, ops].map((p) => [String(p._id), p.client]));
  const projBillable = new Map([web, app, portal, brand, ops].map((p) => [String(p._id), p.billable]));
  const entries: Record<string, unknown>[] = [];
  for (let d = -20; d <= 0; d++) {
    const day = addDays(today, d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    if (d === 0 && new Date().getHours() < 10) continue;
    for (const u of team) {
      const mine = tasks.filter((t) => String(t.assignee) === String(u._id));
      if (!mine.length) continue;
      const blocks = u === alex ? 3 : 4;
      let hour = 9;
      for (let b = 0; b < blocks; b++) {
        const t = rand() < 0.15 ? tasks.find((x) => String(x.project) === String(ops._id))! : pick(mine);
        const minutes = pick([45, 60, 90, 90, 120, 120, 150]);
        const startedAt = new Date(day);
        startedAt.setHours(hour, pick([0, 15, 30]));
        hour += Math.ceil(minutes / 60) + (b === 1 ? 1 : 0);
        const billable = (projBillable.get(String(t.project)) ?? true) && rand() > 0.08;
        entries.push({ org: org._id, user: u._id, task: t._id, project: t.project, client: projClient.get(String(t.project)) ?? undefined, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60000), minutes, billable, source: rand() > 0.5 ? "timer" : "manual", description: billable ? undefined : "Internal sync" });
      }
    }
  }
  await TimeEntry.insertMany(entries);

  /* comments */
  const byTitle = (s: string) => tasks.find((t) => t.title.startsWith(s))!;
  const C = (task: string, author: typeof alex, body: string, hoursAgo: number) => ({ org: org._id, task: byTitle(task)._id, author: author._id, body, createdAt: new Date(Date.now() - hoursAgo * 3600_000) });
  await Comment.insertMany([
    C("Cart & checkout", priya, "Jordan confirmed Apple Pay is a must-have for launch. @Diego can we fit it in this sprint?", 30),
    C("Cart & checkout", diego, "Yes — Stripe Payment Element gives us Apple Pay for free. Webhook handler is next.", 26),
    C("Secure messaging", alex, "Attachment scanning is the last blocker before review sign-off.", 20),
    C("Secure messaging", diego, "ClamAV container is up in staging, wiring it in today.", 6),
    C("Logo exploration", sam, "Uploaded round 2 to Figma — leaning towards route B.", 10),
    C("Logo exploration", priya, "Route B looks great. Let's tighten the wordmark spacing before Thursday.", 4),
    C("Migrate 1,200 product", diego, "~200 products have malformed variants; writing a cleanup script.", 50),
    C("HIPAA security review", alex, "@Priya please book the re-test with the security vendor for next week.", 3),
  ]);

  /* notifications for the demo admin */
  await Notification.insertMany([
    { org: org._id, user: alex._id, type: "mention", title: "Diego Ramirez commented on PORT-2", body: "ClamAV container is up in staging, wiring it in today.", link: `/projects/${portal._id}?task=${byTitle("Secure messaging")._id}`, createdAt: new Date(Date.now() - 6 * 3600_000) },
    { org: org._id, user: alex._id, type: "assigned", title: "Priya Shah assigned you OPS-4", body: "Write proposal for Greenleaf Co", link: `/projects/${ops._id}?task=${byTitle("Write proposal")._id}`, createdAt: new Date(Date.now() - 24 * 3600_000) },
    { org: org._id, user: alex._id, type: "due_soon", title: "PORT-4 is overdue", body: "HIPAA security review & pen test fixes", link: `/projects/${portal._id}?task=${byTitle("HIPAA")._id}`, read: false, createdAt: new Date(Date.now() - 2 * 3600_000) },
    { org: org._id, user: alex._id, type: "status", title: "WEB-3 moved to Review", body: "Product listing page with filters", link: `/projects/${web._id}`, read: true, createdAt: new Date(Date.now() - 48 * 3600_000) },
  ]);

  /* activity feed */
  const A = (actor: typeof alex, verb: string, summary: string, project: typeof web, hoursAgo: number) => ({ org: org._id, actor: actor._id, verb, summary, project: project._id, createdAt: new Date(Date.now() - hoursAgo * 3600_000) });
  await Activity.insertMany([
    A(priya, "project.created", "created project Mobile App MVP", app, 24 * 14),
    A(mia, "task.moved", "moved WEB-3 to Review", web, 48),
    A(diego, "task.moved", "moved PORT-2 to Review", portal, 28),
    A(sam, "comment.created", "commented on BRND-3", brand, 10),
    A(priya, "comment.created", "commented on BRND-3", brand, 4),
    A(diego, "comment.created", "commented on PORT-2", portal, 6),
    A(alex, "comment.created", "commented on PORT-4", portal, 3),
    A(sam, "task.moved", "moved APP-7 to Review", app, 2),
    A(diego, "time.logged", "logged 2h", web, 1),
  ]);

  return { org, users: team };
}

export async function resetDb() {
  const db = mongoose.connection.db;
  if (db) await db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

// CLI: `npm run seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { connectDb, disconnectDb } = await import("./db.js");
  await connectDb();
  await resetDb();
  await seedDemo();
  console.log(`Seeded demo workspace. Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  await disconnectDb();
}
