# Crash Test

**Crash Test checks your whole graph8 revenue machine before a customer finds the bug:** the sequences that sell, the links that book and the quotes that bill. It runs fake buyers through your real graph8 setup, reads what actually happened from the sandbox outbox and graph8 records, explains each failure in plain English with the leads and pipeline at risk, fixes it on Autopilot or after approval, and proves the fix with a re-test. Results are written back to graph8 as tasks and deal notes, and a pre-flight gate re-tests every sequence edit before it goes live.

> graph8 logs what the machine did. Crash Test proves it does what you think.

**Team:** Usman Hassan · Muhammad Sohaib (graph8 Programmable Revenue Hackathon, 27 Sep 2026)

## Run it

```bash
npm install
cp .env.example .env            # add GRAPH8_API_KEY (sandbox): the only key needed
npm run dev                     # Postgres 16 + API :4000 + worker + web :3000
```

`npm run dev` starts everything. It uses an embedded PostgreSQL 16 (real Postgres binaries, no Docker needed), applies the migrations and seeds the defaults. With Docker you can use `docker compose up -d` instead.

| Command | What it does |
|---|---|
| `npm run gates` | Go / no-go checklist (§03) against the real workspace: sandbox, send reaches the outbox, outbox fields, quotes, booking links, deals, credits, scopes, clean-up |
| `npm run seed:graph8` | Dry run of the demo data (3 sequences with planted problems, prospects, a $15,000 deal with a $12,000 sent quote). Add `-- --apply` to create it in the sandbox |
| `npm run reset:demo` | Clean up fake buyers, undo every fix, restore the planted problems, rebaseline the gate (same as **/ready → Reset demo**) |
| `npm test` | Rules, the graph8 contract, the API (Supertest) and acceptance tests E1–E8 on a real Postgres |
| `npm run typecheck` / `npm run lint` | Strict TypeScript everywhere, ESLint on the web app |

Open **http://localhost:3000/ready** before a demo. Every line must be green.

## Database

PostgreSQL 16 + Prisma 6 (`packages/db`). pg-boss keeps its job queue in the same database (schema `pgboss`). **`DATABASE_URL` in `.env` is the only setting.**

| Setup | `DATABASE_URL` | What `npm run dev` does |
|---|---|---|
| Built-in (default) | `postgresql://crash:crash@localhost:5432/crashtest` | Starts an embedded PostgreSQL 16 (data in `.pgdata/`), migrates, seeds |
| Docker | same as above, after `docker compose up -d` (set `EMBEDDED_PG=off`) | Migrates and seeds your container |
| Your own / hosted (Neon, Supabase, RDS…) | `postgresql://USER:PASS@HOST:5432/DB?sslmode=require` | Migrates and seeds it; no embedded server |

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply all migrations + seed defaults (safe to repeat) |
| `npm run db:studio` | Browse the data at http://localhost:5555 |
| `npm run db:new-migration -- <name>` | After editing `schema.prisma`: create and apply a migration |
| `npm run db:seed` | Re-seed test library, fix modes and settings |

## How it works

```
apps/web (Next.js 16, React 19, Tailwind 4, TanStack Query, Framer Motion, Recharts)
   │  REST + Socket.IO                     ← the browser never sees a key or calls graph8
apps/server (Express 5, zod, Socket.IO)  ── LISTEN crash_events ──┐
   │  pg-boss jobs                                                 │ NOTIFY
apps/worker (pg-boss: run.plan · test.execute · run.fixes · fix.apply · run.finalize · cleanup · gate watch · heartbeat)
   │
packages/core  graph8 client (p-limit 4, retry + backoff, defensive normalizers) · tests · fixes · money · health · gate · report
packages/ai    graph8 copilot + Postgres LlmCache · plan · explain · promiseCheck · personas · report   (every function has a code fallback)
packages/db    Prisma 6 · PostgreSQL 16 (runs, results, evidence, fixes, write-backs, gate events, health, reports, cache, heartbeat)
```

**The loop:** Discover → Plan → Seed fake buyers → Trigger → Observe the outbox → Check (code decides) → Fix (Autopilot or Approve) → Re-test → Write back to graph8 → Clean up.

- **Checks first, fixes second.** Autopilot fixes wait until every check has finished, so pausing a sequence for one problem can't hide another problem on the same sequence. The board goes red first, then the agent fixes and re-tests.
- **Resumable.** Every step is saved before and after, fake buyers have deterministic emails (read before write), and a restarted worker re-queues interrupted work (E7).
- **Honest numbers.** Leads count each contact once, and pipeline counts each open deal once, so "at risk" can never exceed your open pipeline.

## Tests

| ID | Test | Area | What fails it | Fix |
|---|---|---|---|---|
| T1 | Opt-out leak | Sell | An opted-out buyer gets any email | Pause the sequence, withdraw the buyer, create a task |
| T2 | Double tap | Sell | One buyer gets more than N emails a day across two sequences | Withdraw from the lower-priority sequence, create a task |
| T3 | Broken personalisation | Sell | `{{first_name}}`, `Hi ,`, `undefined`, `null` reach the inbox | Pause, and a task names the step and field |
| T4 | Orphan lead | Hygiene | An active lead has no owner, or an owner who left | Re-own through a temporary list (preview count first; `assign-owner` is blocked) |
| T7 | Content check | Sell | No unsubscribe line, template leftovers, or an unapproved promise (the AI must quote the exact sentence) | Pause, and a task quotes the sentence |
| T13 | Quote check | Bill | Total ≠ deal (±1%), no line items, expired, departed sender, opted-out recipient | Task and deal note with both numbers. **Sent quotes are never edited.** |
| T11 | Booking check | Book | A booking link routes to someone who left | Task to fix the host group (no paid bookings created) |
| T8 · T9 | Speed-to-lead · Contact limit | Hygiene · Sell | Off by default (MVP+) | Task · withdraw from extra sequences |

## graph8 platform coverage

| graph8 area | What we use | R/W |
|---|---|---|
| Contacts + custom fields | Fake buyers tagged `crash_test_run`, owners, suppression status | R/W |
| Lists | Tag lists, enrol lists, re-own via list (preview + patch) | R/W |
| Engage: sequences | Steps, enrol, withdraw, pause, resume, step snapshots for the gate | R/W |
| Suppressions | T1 set-up, fixes, undo | R/W |
| Sandbox outbox | Every send observed | R |
| Revenue: deals + notes | $ at risk, T13 amounts, deal notes | R/W |
| Revenue: quotes | T13 totals, line items, expiry, sender, recipient | R only |
| Scheduling | Booking links and hosts (T11) | R |
| Work: tasks | Write-back of every failure and the Monday report | W |
| Roles / org users · mailboxes | Current owners, senders, hosts | R |
| Copilot | AI planning, plain-English copy, promise check, personas, report summary | R |
| Usage | Credit check in `npm run gates` | R |

`docs/ops.json` lists every operation in the contract, and `docs/endpoints*.md` document the shapes we use. `tests/contract.test.ts` fails if the code calls an operation that doesn't exist, or if the app could edit, void or resend a quote.

## Safety

- Keys live only in the server and worker env. The browser only calls our API.
- A run refuses to start unless `/sandbox/status` says sandbox, and `GRAPH8_WORKSPACE_ID` matches if set.
- Fake buyers only use `TEST_DOMAIN`, and code throws on any other address.
- Fixes come from a fixed allow-list. Nothing emails real contacts, deletes real records or edits a sent quote.
- Every applied fix stores its real before/after state from graph8 and can be undone.
- Clean-up withdraws, un-suppresses and deletes every fake buyer, even when a run fails.
- zod validates every request, CORS is locked to the web origin, and share links use random 32-byte tokens.

## Five-minute demo

| Time | Beat |
|---|---|
| 0:00 | "Your revenue machine sells, books and bills on its own. How do you know it works?" Workspace page: health rings, $ open pipeline, quotes. |
| 0:30 | **Run all tests.** Fake buyers are created in graph8 and cards move live. |
| 1:10 | Sell: *"Dana opted out but got 1 email from Q4 Outbound."* Open the real outbox email. Autopilot pauses and removes her, and the re-test passes. |
| 1:50 | Bill: *"Quote Q-1042 says $12,000. The deal says $15,000."* Approve mode: preview → **Apply** → the note appears on the deal in graph8. |
| 2:40 | Gate: edit a live step in graph8 to "we guarantee 50% off". The banner turns BLOCKED within seconds, the sentence is highlighted and the sequence is paused. |
| 3:20 | Judge moment: a judge removes a suppression or enrols a contact twice. Re-run: it goes red → fixed → green. |
| 4:00 | **Report → Save to graph8**: leads and $ protected. Show the task in graph8. |
| 4:30 | One slide: architecture + the coverage table above. |
| 4:50 | "graph8 logs what the machine did. Crash Test proves it does what you think." |

Use **Settings → Demo preset** (Autopilot for pause and withdraw, Approve for deal notes and re-owning) and **/ready → Reset demo** between rehearsals.

**Never say:** "graph8 has no guardrails", "tests deliverability", "works on any CRM", "catches every bug", "fixes quotes" (we flag them), or any booking feature we didn't build.
