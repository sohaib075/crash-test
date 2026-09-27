# Crash Test

> **graph8 logs what the machine did. Crash Test proves it does what you think.**

Crash Test checks your whole graph8 revenue machine before a customer finds the bug: the sequences that sell, the links that book, and the quotes that bill. It runs fake buyers through your real graph8 setup, reads what actually happened from the sandbox outbox and graph8 records, explains each failure in plain English with the leads and pipeline at risk, fixes it on Autopilot or after approval, and proves the fix with a re-test. 

Results are written back to graph8 as tasks and deal notes, and a pre-flight gate re-tests every sequence edit before it goes live.

## Table of Contents
- [About The Project](#about-the-project)
- [How It Works](#how-it-works)
- [Platform Coverage](#platform-coverage)
- [Checks & Tests](#checks--tests)
- [Getting Started](#getting-started)
- [Database Configuration](#database-configuration)
- [Commands](#commands)
- [Deployment](#deployment)
- [Safety & Security](#safety--security)
- [Team](#team)

---

## About The Project

Crash Test is designed to ensure the integrity of your graph8 platform setup. It automatically discovers issues, plans a test strategy, seeds fake buyers, and tracks the resulting outbound actions. By continuously monitoring the sandbox, outbox, quotes, and booking links, it acts as a guardrail against misconfigurations that could leak revenue or harm prospect relationships.

**Key Concepts:**
- **Checks first, fixes second:** Autopilot fixes wait until every check has finished, ensuring one problem doesn't hide another.
- **Resumable & Safe:** Every step is saved before and after. Clean-up scripts ensure fake data is always removed.
- **Honest metrics:** Leads and pipeline numbers are accurately tracked without double-counting.

## How It Works

**The Engine Loop:** 
`Discover` → `Plan` → `Seed fake buyers` → `Trigger` → `Observe the outbox` → `Check` → `Fix (Autopilot or Approve)` → `Re-test` → `Write back to graph8` → `Clean up`

**Architecture:**
```
apps/web (Next.js 16, React 19, Tailwind 4, TanStack Query, Framer Motion, Recharts)
   │  REST + Socket.IO                     ← browser never sees a key or calls graph8
apps/server (Express 5, zod, Socket.IO)  ── LISTEN crash_events ──┐
   │  pg-boss jobs                                                 │ NOTIFY
apps/worker (pg-boss: run.plan · test.execute · run.fixes · fix.apply · run.finalize · cleanup · gate watch · heartbeat)
   │
packages/core  graph8 client (p-limit 4, retry + backoff, defensive normalizers) · tests · fixes · money · health · gate · report
packages/ai    graph8 copilot + Postgres LlmCache · plan · explain · promiseCheck · personas · report (every function has a code fallback)
packages/db    Prisma 6 · PostgreSQL 16 (runs, results, evidence, fixes, write-backs, gate events, health, reports, cache, heartbeat)
```

## Platform Coverage

| graph8 Area | How it's Used | Read/Write |
|---|---|---|
| **Contacts & Fields** | Fake buyers tagged `crash_test_run`, owners, suppressions | R/W |
| **Lists** | Tag lists, enrol lists, re-own via list | R/W |
| **Engage Sequences** | Steps, enrol, withdraw, pause, resume, step snapshots | R/W |
| **Suppressions** | Set-up, fixes, undo | R/W |
| **Sandbox Outbox** | Every send observed | R |
| **Revenue: Deals** | $ at risk, quote comparisons, deal notes | R/W |
| **Revenue: Quotes** | Totals, line items, expiry, sender, recipient | R |
| **Scheduling** | Booking links and hosts | R |
| **Tasks** | Write-back of failures and summary reports | W |
| **Users & Mailboxes**| Current owners, senders, hosts | R |
| **Copilot** | AI planning, plain-English copy, promise check | R |

## Checks & Tests

| ID | Test | Area | Failure Condition | Resolution / Fix |
|---|---|---|---|---|
| **T1** | Opt-out leak | Sell | An opted-out buyer receives any email | Pauses sequence, withdraws buyer, creates task |
| **T2** | Double tap | Sell | Buyer gets > N emails/day across sequences | Withdraws from lower-priority sequence |
| **T3** | Broken personalization | Sell | `{{first_name}}`, `undefined`, `null` in email | Pauses sequence, creates task naming the field |
| **T4** | Orphan lead | Hygiene | Active lead has no owner (or departed owner)| Re-assigns owner through temporary list |
| **T7** | Content check | Sell | No unsubscribe line, unapproved promises | Pauses sequence, quotes the offending sentence |
| **T13** | Quote check | Bill | Total ≠ deal, expired, missing line items | Creates task & deal note (never edits sent quotes) |
| **T11** | Booking check | Book | Link routes to departed team member | Task to fix host group |
| **T8/9**| Speed & Contact limits | Hygiene | Contact limit exceeded (Off by default MVP+) | Withdraws from extra sequences |

## Getting Started

### Prerequisites
- Node.js `22.12` or higher
- A graph8 `GRAPH8_API_KEY` (Sandbox environment)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```
*(Add your `GRAPH8_API_KEY` to the `.env` file)*

3. Start the application:
```bash
npm run dev
```
*(Starts embedded Postgres 16, API on :4000, worker, and web on :3000)*

## Database Configuration

The project uses PostgreSQL 16 and Prisma 6. **`DATABASE_URL` in `.env` is the only setting required.**

| Setup | `DATABASE_URL` | Behavior |
|---|---|---|
| **Built-in (default)** | `postgresql://crash:crash@localhost:5432/crashtest` | Starts embedded PostgreSQL (data in `.pgdata/`), migrates, seeds |
| **Docker** | same as above | Run `docker compose up -d` (set `EMBEDDED_PG=off`). Migrates and seeds container. |
| **Installed PG** | `postgresql://postgres:PASS@localhost:5433/crashtest` | Creates DB if missing, migrates, seeds |
| **Hosted (Neon/RDS)** | `postgresql://USER:PASS@HOST:5432/DB?sslmode=require` | Connects, migrates, seeds; no embedded server. |

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the full stack (web, server, worker, embedded DB) |
| `npm run build` / `npm start` | Production build, then run it (see [Deployment](#deployment)) |
| `npm run gates` | Run Go/No-go checklist against the real workspace (sandbox, outbox, etc.) |
| `npm run seed:graph8` | Dry run demo data. Add `-- --apply` to create it in the sandbox. |
| `npm run reset:demo` | Clean up fake buyers, undo fixes, restore planted problems |
| `npm test` | Run strict acceptance tests on a real Postgres instance |
| `npm run db:check` | Verify DB connection, migrations, and job queue health |
| `npm run db:studio` | Browse the data via Prisma Studio (`localhost:5555`) |
| `npm run typecheck` | Strict TypeScript type checking |
| `npm run lint` | ESLint on the web application |

## Deployment

Crash Test ships as **one Docker image** (web app, API and worker) plus a **PostgreSQL** database.

- **One public port:** only the web app listens publicly, on `$PORT` (default 3000). It forwards `/api` and `/socket.io` to the API, which listens on loopback inside the container. So you get one URL, no CORS, and live updates over websockets.
- **Automatic migrations:** on every start, the database is migrated and the defaults are seeded (safe to repeat). Then the three services start. If one stops, the container exits so the platform restarts it.
- **Health check:** `GET /api/health`.
- **Resources:** give it at least **1 GB RAM**, since it runs three Node processes.

### Settings (`.env.production.example` lists them all)

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string (the database is created and migrated on start) |
| `APP_PASSWORD` | yes | Password for the whole app, at least 12 characters (`openssl rand -base64 24`). The browser asks once (any user name). Shared report links (`/r/…`) and `/api/health` stay public. The app refuses to start without one unless `ALLOW_NO_PASSWORD=1` (private networks only). |
| `GRAPH8_API_KEY` | yes | Runs need a developer-sandbox key (`g8_sbx_…`); a live key is read-only here |
| `GRAPH8_BASE_URL` | with a sandbox key | The graph8 developer-sandbox API base URL |
| `GRAPH8_WORKSPACE_ID` | recommended | Runs refuse any other workspace (the `org_id` from `GET /sandbox/status`) |
| `GRAPH8_AI` | no | `on` (graph8 copilot, uses credits) or `off` (rules only) |
| `PORT` | no | Public port (hosts like Render and Railway set it) |

Keys stay on the server. Nothing secret is built into the browser bundle, and `.env*` files are kept out of the image.

### Option A: any server with Docker (VPS, EC2, Hetzner…)
```bash
cp .env.production.example .env.production
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
This starts PostgreSQL 16 (data in a volume) and the app on port 3000. Set `POSTGRES_PASSWORD` and `APP_PASSWORD` in `.env.production` first.

For HTTPS on your own domain, point DNS at the server, open ports 80 and 443, set `DOMAIN` and `APP_BIND=127.0.0.1` (so plain HTTP on port 3000 stays private), and add `--profile https`. Caddy then gets and renews the certificate:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production --profile https up -d --build
```

### Option B: Render (one click)
In the Render dashboard, choose **New → Blueprint** and pick this repo. `render.yaml` creates the web service (from the Dockerfile) and a PostgreSQL database, wires `DATABASE_URL`, and generates `APP_PASSWORD` (find it in the service's **Environment** tab). Enter `GRAPH8_API_KEY`, `GRAPH8_BASE_URL` and `GRAPH8_WORKSPACE_ID` when asked.

### Option C: Railway, Fly.io or any container host
Deploy the `Dockerfile`, attach a PostgreSQL database, and set the variables above. No other setup is needed.

### Without Docker (a plain Node 22.12+ host)
```bash
npm ci
npm run build   # Prisma client + production web build
npm start       # migrate, then web on $PORT + API + worker
```
`npm start` reads `.env` when it exists; real environment variables take precedence. Like the image, it needs `APP_PASSWORD` (or `ALLOW_NO_PASSWORD=1` for a quick local check).

## Safety & Security

- **Environment Lock:** Keys live only in the server/worker. The browser only communicates with our internal API.
- **Access:** Deployments need `APP_PASSWORD`. Every page, API call and live connection then needs it, except shared report links and the health check. Requests that change something (and the live connection) are refused when they come from another site, so a cached password can't be abused cross-site. Plain `npm run dev` stays open for local work.
- **Sandbox Only:** Runs refuse to start unless the workspace status confirms it is a sandbox environment.
- **Domain Restriction:** Fake buyers exclusively use the `TEST_DOMAIN`.
- **Non-Destructive Fixes:** Fixes are strictly allow-listed. The system never emails real contacts, deletes real user records, or edits sent quotes.
- **Audit Trails:** Every applied fix stores its real before/after state from graph8 and can be fully undone.
- **Strict Clean-up:** The clean-up job withdraws, un-suppresses, and deletes every fake buyer, even if a run fails.

---

**Team:** Usman Hassan & Muhammad Sohaib  
*Built for the graph8 Programmable Revenue Hackathon (Sep 2026)*
