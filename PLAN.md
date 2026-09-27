# Crash Test: build plan v4 status

Source: `Crash_Test_Build_Plan.pdf` (v4, 26 Sep 2026). Code freeze **Sun 27 Sep 5:30 PM PKT**, demo 6:00 PM.
`[x]` built and verified · `[~]` built, needs the live key · `[ ]` not done · `[-]` cut on purpose

## Deviations from v4 (and why)
| v4 says | We did | Why |
|---|---|---|
| Claude via `@anthropic-ai/sdk` | **graph8 copilot** (`POST /copilot/chat`) with the same key, and a Postgres cache | Team decision: the graph8 key is the only key |
| pnpm + Docker Postgres | npm workspaces + Turborepo; **embedded PostgreSQL 16** (docker-compose kept as an option) | This machine has no Docker or pnpm; same Postgres, same schema |
| Next.js 15 | Next.js 16 (React 19) | The current version at scaffold time |
| shadcn/ui | Hand-built components in the same style (Tailwind 4, lucide) | Faster and no generator step |
| Fixes apply as each test fails | **Checks first, fixes after** (run.fixes phase) | A pause from one test hid another test's failure on the same sequence |
| Leads and $ summed per result | **Distinct** contacts and deals | Sums were larger than the whole open pipeline |
| T11 creates a paid booking | T11 checks hosts only (no credits) | A paid booking plus notifications isn't worth it in the demo |

## Scope (§04)
- [x] 0 Foundation: monorepo, Postgres, Prisma (4 migrations), Express 5, pg-boss worker, Next.js, Socket.IO over NOTIFY
- [x] 1 Loop + T1–T4 end to end; `/ready`; reset (API, UI and `npm run reset:demo`)
- [x] 2 T13 quote check + $ pipeline at risk
- [x] 3 Modes (Autopilot / Approve / Off), fix preview, plain-English cards, undo with confirmation in the drawer
- [x] 4 Pre-flight gate (20 s step snapshots → GATE run → blocked banner) + T7 content check; health score
- [x] 5 T11 booking-host check; write-back to graph8 (tasks, deal notes, `crash_test_run` custom field)
- [x] 6 Monday report, save to graph8, share link `/r/[token]`; T8, T9 built (off by default)
- [-] 7 T14 workflow trigger and webhooks: cut (the gate needs step hashes anyway; there is no step-edit webhook)

## Acceptance tests (§05): automated against an in-memory graph8 double + real Postgres
- [x] E1 One click → every test finishes; ≥2 fixed; every red card has a summary; totals never exceed open pipeline
- [x] E2 Opted-out buyer → outbox evidence → pause + withdraw → re-test passes → task in graph8
- [x] E3 Quote $12,000 vs deal $15,000 → both numbers shown → deal note on approval → quote untouched
- [x] E4 A step edited to "guarantee 50% off" → gate catches it in < 30 s, quotes the sentence, pauses
- [x] E5 Approve mode → preview, nothing changes until Apply
- [x] E6 Undo → graph8 back to "before" → Undone
- [x] E7 Job re-delivered mid-test → no duplicate contacts or fixes
- [x] E8 Clean-up → 0 fake buyers, tag list deleted
- [~] **Run E1–E8 live on the demo workspace** once the key is in (Sun 12:00–4:00)

`npm test`: 68 tests (rules, contract, API, E1–E8, review and audit regressions, deployment access).

## Verification pass (Sat 26 Sep, evening)
- `npm run dev` from cold: Postgres + migrations + seed + API + worker + web from one command; heartbeat live.
- Full-stack walkthrough in the browser (real server, worker, pg-boss, Socket.IO; graph8 replaced by the in-memory double in a throwaway harness): every page and button clicked. Run all → red → Autopilot fix → green; approve deal note / re-own; undo with confirmation; re-run from the drawer; gate BLOCKED in 4 s; report build / save / share; Reset demo restores the planted problems; keyboard (focus trap, Esc, Enter on cards); 375 px on all 8 pages; `next build` green.
- Independent code review: 9 findings, all fixed with regression tests. Plus bugs found by the walkthrough:
  - invisible drawer overlay swallowing clicks
  - toasts covering the Undo button
  - Undo on a sequence paused by several findings
  - leads/pipeline double counting
  - wrong buyer named in "fixed" copy
  - T2 counting the fake buyer as a lead
  - phone-width overflow
  - stale error after a re-test
- Still unverified until the key arrives: real graph8 payload shapes (outbox, quote detail, org users, event types). `npm run gates` prints them.

## Full-website audit (Sun 27 Sep, afternoon)
Every page, route and engine path was tested: real key checks, a full-stack browser pass on the QA harness, and a multi-agent audit with adversarial verification. The audit confirmed 43 findings (32 distinct fixes); 3 more were rejected. All 32 are fixed, and `tests/audit.test.ts` covers them:
- **API errors:** bad JSON → 400, an oversized body → 413; only graph8 failures are 502/503; a missing row → 404; Prisma internals are never leaked. `limit`, test ids and report ids are validated.
- **Fix lifecycle:**
  - Skip only works on a live proposal (409 otherwise). Undo only works on an applied fix (409).
  - Re-run returns 409 while the test is still running.
  - Autopilot claims each fix before applying it.
- **Re-run this test** now checks again from scratch. A new failure gets its fix proposals; a pass retires proposals that are no longer needed; a fixed result stays fixed.
- **Undo of the fix that made a result FIXED** puts the result back to failing ("→ fix undone").
- **Reset demo during a run:**
  - It stops the run first; its open tests show "Stopped by demo reset".
  - A stopped run starts no tests and creates no buyers.
- **Clean-up** retires proposals that act on a deleted test buyer. Tasks keep their text but drop the contact link.
- **Gate:**
  - Undoing the gate's pause, or a later clean edit, releases the block, so the banner clears.
  - A check that couldn't run says so; it never says "passed".
  - Added or removed steps count as changes.
- **Numbers:**
  - Health uses the weights from Settings.
  - The report uses the latest score per sequence and ranks top issues by pipeline, one row per finding.
  - The chart counts passes and "couldn't check" results separately.
  - The run board shows this run's scores and counts checks that couldn't run.
- **UI:**
  - Card Apply only applies approvals and shows its pending state and errors.
  - The drawer no longer steals focus on re-render.
  - Mode chip, quote tolerance, template-aware highlighting, and step delays in days, hours and minutes.
  - Error states replace empty states.
  - Re-read, weight, gate and share-link errors show a toast. A share link that can't be copied is shown on the page.
  - T4 says "couldn't check" if graph8's team list can't be read.

### Second verification round (Sun 27 Sep, ~3 PM)
18 independent agents checked every fix against the code (4 slice verifiers, 1 regression hunter, and skeptics who tried to refute each new issue). 26 of the 32 groups were fully fixed; 6 were partial. All of those, plus the new issues that survived refutation, are now fixed and covered in `tests/audit.test.ts`:
- **Finalize race** (found under CPU load):
  - A queued finalize could land between "fix applied" and "re-test started", then score health early and delete buyers mid re-test.
  - Fix: the fix phase and mid-run approvals now hold their results RUNNING until settled. Skip never releases someone else's hold.
  - Apply on a busy result returns 409, and the drawer hides fix buttons while a check runs.
- **Reset demo:**
  - A run stopped while planning stays stopped.
  - The fix phase stops mid-way on a reset.
  - Undoing a withdraw of an already-deleted test buyer is a no-op, not an error.
- **Re-run this test:**
  - One re-check at a time (claimed in the route). Re-running a stopped run returns 409.
  - A re-check that can't run keeps the result's verdict.
  - A failing re-check on a FIXED result asks the test whether its fix still contains the problem. For T7, a paused sequence stays FIXED ("still contained").
  - An undone or skipped fix can be proposed again when the problem comes back.
- **Worker restart:** stale fix claims are released and interrupted work is resumed before any job handler starts. Results held by an interrupted fix phase are settled by the fix phase, not re-tested.
- **Health:** a sequence's health is the latest observation of each test, from any run, so a gate run that only re-checks the copy can't erase an earlier opt-out leak. Each failing test counts once (T2 pairs). Health is re-scored after a re-check.
- **Report:** a flagged quote with no linked deal counts once, not once per run. Readiness uses the quote tolerance from Settings.
- **API:**
  - A malformed URL returns 400.
  - Unknown server errors return a generic 500 without internals.
  - P2025 is logged.
- **UI:**
  - Template-aware highlighting in sequence evidence.
  - Per-card Apply state, and claimed fixes aren't offered again.
  - Loading and "Re-checking…" wording.
  - Weight input restores the saved value after a failed save.
  - Stale share link cleared.
  - Sequence page refreshes on fewer events.
- Refuted, so no change: report headline counts per result row (by design; top issues are per finding).

## Sandbox key (Sun 27 Sep, ~3:40 PM)
A `g8_sbx_` key was provided. graph8 rejects it on production (`be.graph8.com`: "Sandbox keys work only against the graph8 developer sandbox") and on QA (`be.qa.graph8.com`: "Invalid API key"). The public docs don't list the sandbox host.
- It's stored, commented, in `.env` with switch instructions. The live key stays active so the app keeps working read-only.
- **Needed:** the developer-sandbox base URL from the hackathon organisers. Then set `GRAPH8_BASE_URL`, activate the sandbox key, and set `GRAPH8_WORKSPACE_ID` to the `org_id` from `GET /sandbox/status`.

## Deployment (Sun 27 Sep, ~4 PM)
- One image (`Dockerfile`, Node 24, tini). `scripts/start.mjs` migrates and seeds, then runs the web app on `$PORT`, the API on 127.0.0.1:4000 and the worker. If one of them dies, the container exits.
- One origin: `next.config.ts` rewrites `/api` and `/socket.io` to the API. The browser uses same-origin URLs and the socket polls first, then upgrades. `NEXT_PUBLIC_API_URL` is optional.
- `APP_PASSWORD`:
  - HTTP Basic auth in `apps/web/proxy.ts` and again in the API (Express and socket.io).
  - Public: `/r/…` share pages (which now make no private calls), `/api/public/…`, `/api/health` and static files.
- Configs:
  - `docker-compose.prod.yml`: Postgres 16 plus the app, with optional Caddy HTTPS (`--profile https`).
  - `render.yaml`: Render blueprint.
  - `.env.production.example`.
  - `.dockerignore` excludes every `.env*` at any depth.
  - `README.md` has a new Deployment section.
- Verified locally with the real production path (`npm run build` and `npm start`, no Docker on this machine):
  - First boot on an empty database creates, migrates and seeds it; a restart is idempotent.
  - Without the password: pages, APIs, socket, `/api/healthx` and an encoded `/%61pi/runs` all return 401. Health, share page, public report API and static files return 200.
  - The API on :4000 also returns 401 without the password.
  - Socket.io handshake works with and without the trailing slash, then upgrades to a websocket through the proxy. A wrong password is refused.
  - In the browser, the app works behind the password and a share link makes only its public call.
- Found and fixed while verifying:
  - The socket.io trailing slash (the server now accepts both forms).
  - An old `apps/web/.env.local` was baking `NEXT_PUBLIC_API_URL=http://localhost:4000` into production builds. It's removed, and `.dockerignore` now covers nested `.env*` files.
- Independent review (16 agents, 4 areas, with a skeptic for each finding): 8 confirmed, 4 refuted because the current files already had the fix. All confirmed findings are fixed, plus the low-severity ones:
  - **Leak:** `.pgdata` (the local database) would have been copied into the image. `.dockerignore` now excludes it, along with `data`, `docs`, `tests` and `*.md`.
  - **CSRF:** with Basic auth, a browser attaches the cached password for any site. Mutating API calls and the live socket are refused when they come from another site (`Sec-Fetch-Site`, and `Origin` against the forwarded host).
  - **Fail closed:** `start.mjs` refuses to start without an `APP_PASSWORD` of 12+ characters (opt out with `ALLOW_NO_PASSWORD=1`). Render generates one, and Compose requires it.
  - **Proxy timeout:** Next's rewrite proxy timeout went from 30 s to 300 s (Reset demo and first discovery can exceed 30 s). Non-JSON 5xx responses now show a clear message.
  - **Overlapping deploys:** the worker is a singleton (Postgres advisory lock), so a new container waits for the old worker instead of re-running its tests.
  - **Compose:**
    - The database URL is built and encoded from `POSTGRES_*`, so any password works.
    - `pg_isready` checks over TCP.
    - `DOMAIN` is optional unless the https profile is used.
    - `APP_BIND` keeps plain HTTP private behind Caddy, and Caddy sends HSTS.
  - **Runtime:**
    - `tsx` runs in-process (`node --import tsx`). This saves about 80 MB (384 MB idle) and lets signals reach the services.
    - Signals are handled during migrations.
    - A crashed child gives a non-zero exit.
    - The API only stops pg-boss if it started it, and the LISTEN reconnect backs off instead of crashing.
    - Migrations retry (6 × 5 s) while the database starts.
  - **Headers:** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (share tokens live in URLs). `tini` runs as PID 1.
  - **Docs:** use the direct (not pooler) `DATABASE_URL`, sslmode notes for private CAs, Render database `ipAllowList: []`, and at least 1 GB RAM.
- Dev (`npm run dev`) uses the same proxy: API, live data and websocket verified. No password in dev.
- **Not done yet:** the deployment files aren't committed. Render and Railway build from the git repository.

## Live-safe mode (Sun 27 Sep, ~4:45 PM)
The sandbox key can't be used yet: its base URL is unknown, and graph8 rejects it on both documented servers. So a live key now runs in **live-safe mode** instead of being refused:
- **Checks:** only T4, T7, T9, T11 and T13 run (they only read graph8). T1, T2, T3 and T8 are skipped, with a log line saying why.
- **Safety:** `ctx.buyer` refuses to create a fake buyer on a live-safe run, and every fix (including the gate's automatic pause) is forced to Approve.
- **UI and readiness:** they show the mode ("Run safe checks", a banner, and a `live-safe` label on the run page).
- **Opt out:** `LIVE_SAFE_MODE=off` restores the strict refusal.
- **Live test on "Hackathon Usman Hassan":** 6 checks and 3 real findings: two quotes that don't match their deals, and a booking link routed to someone who left. $11,200 at risk, 0 fake buyers, 0 emails, nothing changed.
- `tests/livesafe.test.ts` covers it. `npm test`: 72 tests.

## Go-live checklist (needs GRAPH8_API_KEY)
1. [ ] Put the key in `.env`, then `npm run dev`
2. [ ] `npm run gates`. **G1 green by 1:00 PM or switch to Baton.** Read the raw outbox and quote keys it prints; tighten `packages/core/src/graph8/normalize.ts` if a field is missing
3. [ ] Set `OUTBOX_TIMEOUT_MS` / `NEGATIVE_WAIT_MS` from the measured send latency (2–3×)
4. [ ] `npm run seed:graph8` (dry run) → check the payloads → `-- --apply`; set the 3 sequences live; clear 2 owners
5. [ ] `/ready` all green; **Settings → Demo preset**
6. [ ] Full run; confirm red → fixed → green on Q4 Outbound, T13 needs approval, T4 needs approval
7. [ ] Gate: edit Q4 step 2 in graph8, BLOCKED within ~30 s
8. [ ] Record the fallback video; 3 rehearsals with **Reset demo** in between
9. [ ] Secrets check, public repo, submit the paragraph (README top) by 5:30

## Risks
| Risk | Mitigation in code |
|---|---|
| Sends don't reach the outbox | `npm run gates` G1; 1:00 PM decision |
| Untyped payloads (outbox, quote detail, org users, event types) | Defensive normalizers; gates print the raw keys |
| graph8 honours suppressions (T1 green on real flows) | That's a pass, and we say so; use the judge break for the red moment |
| Copilot slow, down or costly | Postgres cache + code fallback for every AI function; `GRAPH8_AI=off` |
| Rate limits / 5xx | p-limit(4), retry with backoff + jitter, a clear ERROR card with a hint |
| Worker crash mid-run | Resume on start; idempotent steps (E7) |

## Live key test (Sun 27 Sep, morning): org "Hackathon Usman Hassan", live key, 139 scopes
- 18/18 real graph8 writes pass through Crash Test's own backend: list, fake contact, custom-field tag, read-before-write lookup, add to list, suppress → reinstate, task create/delete, re-own preview + apply via a temporary list, clear owner via a list, clean-up lookup, withdraw, delete contact/list. No contact left behind.
- Fixed from live data:
  - contacts' `owner_id` is the **team-member id** (`/team-members`), not the org user id. It's now mapped via `propelauth_user_id`, so T4 no longer flags every owned lead.
  - graph8 ignores unknown `custom_fields` on create, so the `crash_test_run` column is created once and set through the fields API.
- graph8 copilot works (`source=ai`, about 12 credits and 7–16 s per call). T7 gives the AI 25 s on normal runs and 8 s on gate runs.
- **Still blocked:** the key is `live`, not a sandbox, so `/sandbox/outbox` returns 404. Send-based tests (T1, T2, T3, T8) need a **test-mode / developer-sandbox key**.
