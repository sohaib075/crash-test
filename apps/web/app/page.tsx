"use client";

import type { Settings, WorkspaceDTO } from "@crash/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileText, Play, RefreshCw, Send, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/providers";
import { Button, ErrorBox, HealthRing, Panel, Skeleton, StatTile } from "@/components/ui";
import { api, ApiError, post } from "@/lib/api";
import { ago, money } from "@/lib/format";

export default function WorkspacePage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const ws = useQuery({ queryKey: ["workspace"], queryFn: () => api<WorkspaceDTO | null>("/api/workspace") });
  const run = useMutation({
    mutationFn: () => post<{ id: string }>("/api/runs", {}),
    onSuccess: (d) => router.push(`/runs/${d.id}`),
    onError: (e: ApiError) => {
      if (e.code === "RUN_IN_PROGRESS" && e.hint) router.push(e.hint.replace("Open ", ""));
      else toast({ tone: "fail", message: e.message });
    },
  });
  const rediscover = useMutation({
    mutationFn: () => post<WorkspaceDTO>("/api/workspace/discover"),
    onSuccess: (d) => { qc.setQueryData(["workspace"], d); toast({ tone: "pass", message: "Re-read graph8" }); },
    onError: (e: Error) => toast({ tone: "fail", message: `Couldn't read graph8: ${e.message}` }),
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/api/settings") });

  const w = ws.data;
  // Same rule as the quote check (T13): off by more than the tolerance in Settings.
  const tol = settings.data?.quoteTolerancePct ?? 1;
  const mismatched = w?.quotes.filter((q) => q.total != null && q.dealAmount != null && q.dealAmount > 0 && (Math.abs(q.total - q.dealAmount) / q.dealAmount) * 100 > tol) ?? [];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end gap-6 rounded-2xl border border-line bg-panel px-6 py-6">
        <div className="max-w-2xl">
          <div className="label">{w?.name ?? "graph8 workspace"} {w?.discoveredAt ? `· read ${ago(w.discoveredAt)}` : ""}</div>
          <h1 className="mt-2 font-display text-3xl leading-tight font-extrabold tracking-tight sm:text-[34px]">
            Your revenue machine sells, books and bills on its own. <span className="text-action">How do you know it works?</span>
          </h1>
          <p className="mt-2 text-muted">
            Crash Test runs fake buyers through your real graph8 sequences, quotes and booking links, shows what&apos;s broken in plain English, fixes it and proves the fix.
          </p>
        </div>
        <div className="ml-auto flex flex-col items-end gap-2">
          <Button variant="primary" size="lg" loading={run.isPending} onClick={() => run.mutate()} disabled={!w} title={w && !w.sandbox ? "Live key: read-only checks only, no emails" : undefined}>
            <Play className="h-5 w-5" /> {w && !w.sandbox ? "Run safe checks" : "Run all tests"}
          </Button>
          <button onClick={() => rediscover.mutate()} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink" disabled={rediscover.isPending}>
            <RefreshCw className={`h-3.5 w-3.5 ${rediscover.isPending ? "animate-spin" : ""}`} /> Re-read graph8
          </button>
        </div>
      </section>

      {ws.error && (
        <ErrorBox
          error={(ws.error as ApiError).code === "NO_KEY" ? { message: "graph8 isn't connected yet", hint: "Add GRAPH8_API_KEY (sandbox) to .env and restart the server." } : ws.error}
          onRetry={() => ws.refetch()}
        />
      )}

      {w && !w.sandbox && (
        <div className="flex gap-4 rounded-2xl border border-action/50 bg-action/[0.06] px-5 py-4" role="alert">
          <div className="hazard w-1.5 shrink-0 rounded-full" />
          <div className="text-sm">
            <div className="font-display text-base font-semibold text-action">Live-safe mode: {w.name} is connected with a {w.keyMode ?? "live"} key</div>
            <p className="mt-1 text-muted">
              Runs use <b className="text-ink">read-only checks</b> only: orphan leads, content check, contact limit, booking hosts and quote check.
              No fake buyers are created and <b className="text-ink">no email is sent</b>. Every fix waits for your approval before anything changes in graph8.
            </p>
            <p className="mt-1 text-muted">
              The send tests (opt-out leak, double tap, broken personalisation, speed-to-lead) need a <b className="text-ink">graph8 developer sandbox</b> key and its base URL in{" "}
              <code className="font-mono text-ink">.env</code>.
            </p>
          </div>
        </div>
      )}

      {ws.isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      )}

      {w && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Open pipeline" value={w.openPipeline} format={(n) => money(n, true)} hint={`${w.openDeals} open deals`} />
            <StatTile label="Sequences" value={w.sequences.length} hint={`${w.sequences.filter((s) => /live|active/.test(s.status)).length} live`} />
            <StatTile label="Sent quotes" value={w.quotes.length} tone={mismatched.length ? "text-action" : ""} hint={mismatched.length ? `${mismatched.length} ${mismatched.length === 1 ? "doesn't" : "don't"} match ${mismatched.length === 1 ? "its" : "their"} deal` : "all match their deals"} />
            <StatTile label="Last run" value={w.lastRun?.totals.fixed ?? 0} hint={w.lastRun ? `fixed · ${ago(w.lastRun.startedAt)}` : "no runs yet"} />
          </div>

          {w.lastRun && (
            <Link href={`/runs/${w.lastRun.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-panel px-4 py-3 text-sm hover:bg-panel-2">
              <span className="label">Last run</span>
              <span className="font-mono text-pass">{w.lastRun.totals.pass} passed</span>
              <span className="font-mono text-pass">{w.lastRun.totals.fixed} fixed</span>
              <span className="font-mono text-fail">{w.lastRun.totals.fail + w.lastRun.totals.needsApproval} open</span>
              <span className="font-mono text-action">{money(w.lastRun.totals.pipelineAtRisk)} pipeline at risk</span>
              <span className="ml-auto text-action">Open the board →</span>
            </Link>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel title={<span className="inline-flex items-center gap-1.5"><Send className="h-3.5 w-3.5 text-run" /> Sell · sequences</span>}>
              {!w.sequences.length ? (
                <p className="text-sm text-muted">No sequences in this workspace yet. Crash Test will check them as soon as they exist.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {w.sequences.map((s) => (
                    <Link key={s.id} href={`/sequences/${s.graph8Id}`} className="flex gap-4 rounded-xl border border-line bg-lab/60 p-4 transition hover:border-line-2 hover:bg-panel-2">
                      <HealthRing score={s.health?.score ?? null} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-display font-semibold">{s.name}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${/pause/.test(s.status) ? "bg-action/15 text-action" : /live|active/.test(s.status) ? "bg-pass/15 text-pass" : "bg-panel-2 text-muted"}`}>{s.status}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {s.steps.length} step{s.steps.length === 1 ? "" : "s"}{s.contactCount != null ? ` · ${s.contactCount} contact${s.contactCount === 1 ? "" : "s"}` : ""} · {s.senderEmails[0] ?? "no sender"}
                        </div>
                        <div className="mt-2 text-xs">
                          {s.health ? (
                            <span className={s.health.band === "HEALTHY" ? "text-pass" : s.health.band === "AT_RISK" ? "text-action" : "text-fail"}>
                              {s.health.band === "HEALTHY" ? "Healthy" : s.health.band === "AT_RISK" ? "At risk" : "Broken"}{s.health.reasons.length ? ` · ${s.health.reasons.join(", ")}` : ""}
                            </span>
                          ) : <span className="text-faint">Not tested yet</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <div className="space-y-6">
              <Panel title={<span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-action" /> Bill · sent quotes</span>}>
                {!w.quotes.length ? <p className="text-sm text-muted">No sent quotes.</p> : (
                  <ul className="divide-y divide-line text-sm">
                    {w.quotes.map((q) => {
                      const bad = mismatched.includes(q);
                      return (
                        <li key={q.id} className="flex items-center gap-3 py-2">
                          <span className="font-mono">{q.number}</span>
                          <span className={`ml-auto font-mono ${bad ? "text-fail" : ""}`}>{money(q.total)}</span>
                          <span className="font-mono text-xs text-faint">deal {money(q.dealAmount)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
              <Panel title={<span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 text-book" /> Book · booking links</span>}>
                {!w.bookingLinks.length ? <p className="text-sm text-muted">No booking links found.</p> : (
                  <ul className="space-y-2 text-sm">
                    {w.bookingLinks.map((b) => (
                      <li key={b.id}>
                        <div className="font-medium">{b.name}</div>
                        <div className="truncate text-xs text-muted">{b.hosts.length ? b.hosts.join(", ") : "hosts not listed"}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title={<span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-hygiene" /> Hygiene · team</span>}>
                <ul className="space-y-1 text-sm">
                  {w.users.slice(0, 8).map((u) => <li key={u.id} className="flex justify-between gap-2"><span className="truncate">{u.name}</span><span className="truncate text-xs text-faint">{u.email}</span></li>)}
                </ul>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
