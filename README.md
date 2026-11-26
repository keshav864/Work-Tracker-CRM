# Work Tracker CRM

A MERN work-tracking CRM for teams doing client work. It covers clients and contacts, projects, Kanban tasks, timers and timesheets, invoice summaries and a team dashboard. Updates arrive in real time over Socket.IO. AI features run on Claude and fall back to an offline mode when no API key is set.

**Stack:** MongoDB (Mongoose) · Express 5 · React 19 + Vite + TypeScript + Tailwind 4 · Node.js · Socket.IO · Zod · Anthropic SDK (`claude-opus-5-5`)

---

## Quick start

```bash
npm install
npm run dev
```

- Web: <http://localhost:5174>, API: <http://localhost:4100>. Vite proxies `/api` and `/socket.io` to the API.
- You don't need MongoDB installed. If `MONGODB_URI` isn't set, the API starts an embedded MongoDB (`mongodb-memory-server`). It stores data in `.data/mongo`, so your data survives restarts. The first run downloads the `mongod` binary once (about 80 MB unpacked) into `.data/mongodb-binaries`.
- An empty database gets seeded with a demo agency on first start. Click **Explore the demo workspace** to sign in, or use `demo@worktracker.dev` / `demo1234`. That user is the admin. All other demo users share the same password: `priya@` (manager), and `sam@`, `diego@`, `mia@` (members).

> npm 11+/12 may warn that `esbuild`/`mongodb-memory-server` install scripts were blocked. You can ignore that. Builds still work, and the Mongo binary downloads on first use.

### Scripts (repo root)

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) and web (Vite) together |
| `npm run build` | Type-checks and builds the server (`server/dist`) and the web app (`web/dist`) |
| `npm start` | Runs the built API. With `NODE_ENV=production` it also serves `web/dist` |
| `npm test` | Backend integration tests (node:test + supertest, on an ephemeral in-memory MongoDB) |
| `npm run typecheck` | `tsc --noEmit` for both workspaces |
| `npm run seed` | Wipes the database and reloads the demo data. With the embedded DB, stop `npm run dev` first because both use the same data directory |

### Configuration

Copy `.env.example` to `.env` in the repo root. Every value is optional for local dev.

| Variable | Default | Notes |
|---|---|---|
| `MONGODB_URI` | *(empty → embedded)* | Any MongoDB 6+ URI. See below |
| `JWT_SECRET` | dev placeholder | **Set this** anywhere that isn't your laptop |
| `ANTHROPIC_API_KEY` | *(empty → demo AI)* | Turns on live Claude for the AI features |
| `CLAUDE_MODEL` | `claude-opus-5-5` | |
| `PORT` / `CORS_ORIGIN` | `4100` / `http://localhost:5174` | |
| `AUTO_SEED` | `true` | Set to `false` to start with an empty DB |

### Using a real MongoDB or Atlas

- **Local or Docker:** run `docker run -d -p 27017:27017 --name mongo mongo:8`, then set `MONGODB_URI=mongodb://127.0.0.1:27017/work_tracker`.
- **MongoDB Atlas:** create a free cluster and a database user. Add your IP to the network access list. Then set
  `MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/work_tracker?retryWrites=true&w=majority`.
- Restart the API. Indexes are created automatically. Run `npm run seed` if you want the demo data there.

---

## Features

**Workspace and auth**
- Sign up creates an organization (workspace), and you become its admin. Auth uses JWT bearer tokens and bcrypt-hashed passwords.
- Roles:
  - **admin:** people, roles, rates, workspace settings, deleting projects and clients
  - **manager:** clients, projects, invoices, everyone's timesheets
  - **member:** tasks and their own time
- Every query is scoped to the caller's organization.

**Clients and contacts**
- Client list with status (lead, active, paused, churned), hourly rate, project and contact counts, and logged/billable hours.
- Client page with contacts (one is marked primary), projects, notes and an **invoice summary**.

**Projects and tasks**
- Projects have a short key (`WEB`), so tasks get IDs like `WEB-12`. They also have a client, color, due date, hour budget, billable flag, rate override and members.
- **Kanban board** with drag and drop: Backlog → To do → In progress → Review → Done. Card position uses fractional ordering, and the board updates optimistically. There's also a list view, plus search and assignee filters.
- Tasks have priority, assignee, due date, estimate, labels, a **subtask checklist**, **comments with @mentions**, and **attachment metadata** (name and link, e.g. Drive or Figma).

**Time tracking**
- One-click **timer** from any task or project. Only one timer runs per user, and it syncs live across tabs. Starting a timer on a todo task moves it to In progress.
- Manual entries, billable or non-billable.
- **Weekly timesheet**: a Mon–Sun grid by project and task, with utilization against each person's weekly capacity.
- **Invoice summary** per client and date range: billable hours by project and person. Rates resolve in this order: project → client → person → workspace default. You can export it as CSV.

**Dashboard**
- Hours this week, team-wide and yours, with a billable/non-billable split by day.
- Team workload: hours logged vs. capacity, open, in-progress and overdue tasks, and estimated hours.
- Overdue tasks, your open tasks, project progress and burn, and a live activity feed.

**Real-time and notifications**
- Socket.IO with JWT auth on connect. Each socket joins `org:<id>` and `user:<id>` rooms.
- Task create, update, move and delete events, comments and activity reach every open board immediately.
- In-app notifications cover assignment, @mention, comment on your task and status change. They show in the bell menu with toasts, and clicking one opens the task.

**AI (Claude, with offline fallback)**

| Feature | Where | Live (Claude) | Demo fallback |
|---|---|---|---|
| Natural-language task creation | **New task** (or press `N`) → "Fill" | Structured output (Zod schema). It resolves teammates, projects and relative dates | Rule-based parser for priority words, `@name`/"for Sam", "by Friday", "next week", `#labels`, `~3h`, project names and keys |
| Break into subtasks | Task drawer → AI assist | 4–8 concrete subtasks | Templates per work type (bug, design, API, page, report, launch, meeting) |
| Effort estimate | Task drawer → AI assist | Hours, range, confidence and rationale, using **historical actuals** from similar completed tasks | Scope heuristic blended with the same historical actuals |
| Weekly status report | Project → **Status report** | Client-ready Markdown written from live project stats | Deterministic report with an On track / At risk / Off track verdict |

Live mode sends requests through `@anthropic-ai/sdk` (`client.beta.messages.parse` with `betaZodOutputFormat`). It uses prompt caching on the system prompt, an explicit `effort` setting, and server-side refusal fallbacks (`fallbacks: "default"`). If a Claude call fails, the endpoint falls back to the heuristic and returns a `warning`, so you're never blocked. `GET /api/ai/status` reports which mode is active, and the sidebar shows it too.

---

## Architecture

```
work-tracker/
├─ server/                 Express API (TypeScript, ESM)
│  └─ src/
│     ├─ index.ts          boot: connect DB → auto-seed → HTTP + Socket.IO
│     ├─ app.ts            express app (helmet, cors, routes, error handler); serves web/dist in prod
│     ├─ db.ts             MONGODB_URI or embedded mongodb-memory-server (persistent dbPath)
│     ├─ models.ts         Mongoose schemas: Organization, User, Client, Contact, Project,
│     │                    Task (embedded subtasks + attachments), Comment, TimeEntry,
│     │                    Notification, Activity
│     ├─ realtime.ts       Socket.IO hub, logActivity(), notify()
│     ├─ lib/http.ts       JWT auth middleware, role guard, Zod parse, error → JSON mapping
│     ├─ routes/           auth+users+org · clients(+contacts) · projects · tasks(+subtasks,
│     │                    attachments, comments, move) · time(+timer, timesheet, invoice) ·
│     │                    misc (dashboard, notifications, activity, ai)
│     ├─ ai/claude.ts      Anthropic client wrapper (structured() / complete())
│     ├─ ai/features.ts    parseTask · breakdownTask · estimateTask · statusReport (+ heuristics)
│     ├─ seed.ts           demo workspace (deterministic)
│     └─ tests/            API integration tests
└─ web/                    React SPA (Vite)
   └─ src/
      ├─ lib/              api client, auth + socket context, timer context, hooks, types
      ├─ components/       Layout (sidebar, timer pill, notifications), TaskDrawer,
      │                    NewTaskModal (AI fill), ui primitives
      └─ pages/            Login, Dashboard, MyTasks, Projects, Project (Kanban), Clients,
                           Client (contacts + invoice), Time (timesheet), Team
```

**Request flow:**
1. React calls `/api/*` with `Authorization: Bearer <jwt>`.
2. `requireAuth` loads the user and their org.
3. The Zod schema validates the body. A validation error returns 400 with field paths.
4. The Mongoose query is scoped to `org`.
5. Mutations write an `Activity` row and any `Notification`s, then emit Socket.IO events to `org:<id>` and `user:<id>`.
6. The client merges events into local state, so there's no polling.

**Data model notes:**
- Subtasks and attachments are embedded in `Task`, because they're always read with it.
- Comments and time entries are separate collections, because they grow without bound and need their own aggregations.
- Each `TimeEntry` also stores `project` and `client`. That lets timesheet, invoice and dashboard aggregations run without joins.
- Task numbers come from an atomic `$inc` on `Project.taskSeq`.

**API overview:** all routes are under `/api` and JSON-only.

| Area | Routes |
|---|---|
| Auth | `POST auth/register`, `POST auth/login`, `GET auth/me` |
| Team | `GET/POST users`, `PATCH users/:id`, `GET/PATCH org` |
| Clients | `GET/POST clients`, `GET/PATCH/DELETE clients/:id`, `POST clients/:id/contacts`, `PATCH/DELETE clients/contacts/:id` |
| Projects | `GET/POST projects`, `GET/PATCH/DELETE projects/:id` |
| Tasks | `GET tasks?project=&assignee=me&status=&q=&overdue=1`, `POST tasks`, `GET/PATCH/DELETE tasks/:id`, `POST tasks/:id/move`, `POST/PATCH/DELETE tasks/:id/subtasks[/:sid]`, `POST/DELETE tasks/:id/attachments[/:aid]`, `GET/POST tasks/:id/comments`, `DELETE tasks/comments/:cid` |
| Time | `GET time/current`, `POST time/start`, `POST time/stop`, `GET/POST time`, `PATCH/DELETE time/:id`, `GET time/timesheet?week=&user=`, `GET time/invoice?client=&from=&to=` |
| Other | `GET dashboard`, `GET notifications`, `POST notifications/read-all`, `POST notifications/:id/read`, `GET activity`, `GET ai/status`, `POST ai/parse-task`, `POST ai/breakdown`, `POST ai/estimate`, `POST ai/status-report` |

## Testing

`npm test` runs 17 integration tests against a throwaway in-memory MongoDB. They cover:
- register and login, auth and role gates, validation errors
- task numbering, assignment and @mention notifications, moves and progress
- the timer, timesheets and their permissions
- invoice pricing and the dashboard
- the natural-language parser and every AI endpoint in demo mode
- loading the demo seed

## Production notes

- Run `npm run build`, then start with `NODE_ENV=production npm start`. A single Node process serves the API, Socket.IO and the built SPA.
- Set `MONGODB_URI` and a strong `JWT_SECRET`. Set `CORS_ORIGIN` if the web app is served from a different origin.
- File uploads store metadata and links only. To store real files, add S3 or GCS presigned uploads behind `POST /tasks/:id/attachments`.
- Teammates are added by an admin with a temporary password. An invite-email flow is the next step for a hosted version.
