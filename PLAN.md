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

`npm test`: 41 tests (rules, contract, API, E1–E8, review regressions).

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
