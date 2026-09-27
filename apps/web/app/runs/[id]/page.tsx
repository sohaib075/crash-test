"use client";

import type { Area, ResultDTO, RunDTO, WorkspaceDTO } from "@crash/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGroup } from "framer-motion";
import { Play, ScrollText } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import { useLive, useToast } from "@/app/providers";
import { EvidenceList } from "@/components/Evidence";
import { ResultCard } from "@/components/ResultCard";
import { ResultDrawer } from "@/components/ResultDrawer";
import { Button, ErrorBox, HealthRing, Panel, Skeleton, StatTile } from "@/components/ui";
import { api, post } from "@/lib/api";
import { AREA_STYLE, duration, money } from "@/lib/format";

const COLUMNS: { key: string; label: string; match: (r: ResultDTO) => boolean; tone: string }[] = [
  { key: "running", label: "Running", match: (r) => r.status === "RUNNING" || r.status === "QUEUED", tone: "text-run" },
  { key: "approval", label: "Needs approval", match: (r) => r.status === "NEEDS_APPROVAL", tone: "text-action" },
  { key: "failed", label: "Failed", match: (r) => r.status === "FAIL" || r.status === "ERROR", tone: "text-fail" },
  { key: "fixed", label: "Fixed", match: (r) => r.status === "FIXED", tone: "text-pass" },
  { key: "passed", label: "Passed", match: (r) => r.status === "PASS", tone: "text-pass" },
];
const AREAS: (Area | "ALL")[] = ["ALL", "SELL", "BOOK", "BILL", "HYGIENE"];
const ORDER = { FAIL: 0, NEEDS_APPROVAL: 1, ERROR: 2, RUNNING: 3, QUEUED: 4, FIXED: 5, PASS: 6 } as Record<string, number>;

function Board({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { socket } = useLive();
  const [area, setArea] = useState<Area | "ALL">("ALL");
  const open = params.get("result");
  const run = useQuery({ queryKey: ["run", id], queryFn: () => api<RunDTO>(`/api/runs/${id}`), refetchInterval: (q) => (q.state.data?.status === "DONE" || q.state.data?.status === "FAILED" ? false : 4000) });
  const ws = useQuery({ queryKey: ["workspace"], queryFn: () => api<WorkspaceDTO | null>("/api/workspace") });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    socket?.emit("join", id);
    return () => { socket?.emit("leave", id); };
  }, [socket, id]);

  const results = useMemo(() => [...(run.data?.results ?? [])].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)), [run.data]);
  const visible = results.filter((r) => area === "ALL" || r.area === area);
  const focus = results.find((r) => r.id === selected) ?? results.find((r) => r.status === "FAIL" || r.status === "NEEDS_APPROVAL") ?? results.find((r) => r.status === "FIXED");
  const detail = useQuery({ queryKey: ["result", focus?.id], queryFn: () => api<ResultDTO>(`/api/results/${focus!.id}`), enabled: !!focus });

  const openResult = useCallback((rid: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (rid) sp.set("result", rid); else sp.delete("result");
    router.replace(`/runs/${id}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }, [params, router, id]);

  const applyAll = async (r: ResultDTO) => {
    const d = await api<ResultDTO>(`/api/results/${r.id}`);
    for (const f of d.fixes?.filter((x) => x.status === "PROPOSED") ?? []) await post(`/api/fixes/${f.id}/apply`);
    toast({ tone: "info", message: `Applying fix for ${r.targetName}…` });
    qc.invalidateQueries({ queryKey: ["run", id] });
  };

  const again = useMutation({
    mutationFn: () => post<{ id: string }>("/api/runs", {}),
    onSuccess: (d) => router.push(`/runs/${d.id}`),
    onError: (e: Error & { hint?: string }) => toast({ tone: "fail", message: e.message }),
  });

  if (run.error) return <ErrorBox error={run.error} onRetry={() => run.refetch()} />;
  const d = run.data;
  const t = d?.totals;
  const live = d && (d.status === "QUEUED" || d.status === "PLANNING" || d.status === "RUNNING");
  const failed = (t?.fail ?? 0) + (t?.needsApproval ?? 0) + (t?.fixed ?? 0);
  const seqHealth = (ws.data?.sequences ?? []).filter((s) => s.health).sort((a, b) => (a.health!.score - b.health!.score));

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7.5rem)]">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-mono text-xs text-faint">
            {d?.trigger === "GATE" ? "Pre-flight gate run" : "Run"} · {id.slice(-8)} {d ? `· ${duration(d.startedAt, d.finishedAt)}` : ""} {d?.planSource ? `· plan: ${d.planSource === "rules" ? "rules" : "graph8 AI"}` : ""}
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {!d ? "Loading…" : live ? (d.status === "PLANNING" || d.status === "QUEUED" ? "Discovering and planning…" : "Running tests…") : d.status === "FAILED" ? "Run stopped" : failed ? `${failed} problem${failed === 1 ? "" : "s"} found` : "All checks passed"}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {live ? (
            <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-run/40 bg-run/10 px-4 font-mono text-sm text-run">
              <span className="h-2 w-2 animate-pulse rounded-full bg-run" /> {t ? `${t.tests - t.queued - t.running}/${t.tests} done` : "starting"}
            </span>
          ) : (
            <Button variant="primary" loading={again.isPending} onClick={() => again.mutate()}><Play className="h-4 w-4" /> Run all tests</Button>
          )}
        </div>
      </div>
      {d?.error && <ErrorBox error={{ message: d.error }} />}

      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Tests run" value={t?.tests ?? 0} />
        <StatTile label="Failed" value={(t?.fail ?? 0) + (t?.needsApproval ?? 0)} tone={(t?.fail ?? 0) + (t?.needsApproval ?? 0) ? "text-fail" : ""} />
        <StatTile label="Fixed" value={t?.fixed ?? 0} tone={t?.fixed ? "text-pass" : ""} />
        <StatTile label="Leads protected" value={t?.leadsProtected ?? 0} />
        <StatTile label="Pipeline at risk" value={t?.pipelineAtRisk ?? 0} format={(n) => money(n, true)} tone={t?.pipelineAtRisk ? "text-action" : ""} />
      </div>

      {/* area tabs */}
      <div role="tablist" aria-label="Area" className="flex flex-wrap gap-1.5">
        {AREAS.map((a) => {
          const n = a === "ALL" ? results.length : results.filter((r) => r.area === a).length;
          const on = area === a;
          return (
            <button key={a} role="tab" aria-selected={on} onClick={() => setArea(a)} className={`rounded-lg border px-3 py-1.5 text-sm transition ${on ? "border-line-2 bg-panel-2 text-ink" : "border-transparent text-muted hover:text-ink"}`}>
              {a === "ALL" ? "All" : AREA_STYLE[a].label} <span className="ml-1 font-mono text-xs text-faint">{n}</span>
            </button>
          );
        })}
      </div>

      {/* board + side panel */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <LayoutGroup>
          <div className="grid min-h-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {COLUMNS.map((c) => {
              const items = visible.filter(c.match);
              return (
                <div key={c.key} className="flex min-h-[120px] flex-col rounded-2xl border border-line bg-panel/40 lg:min-h-0">
                  <div className="flex items-center justify-between px-3 pt-3 pb-2">
                    <span className={`label !text-[11px] ${items.length ? c.tone : ""}`}>{c.label}</span>
                    <span className="font-mono text-xs text-faint">{items.length}</span>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                    {!d && c.key === "running" && [0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
                    {items.map((r) => (
                      <div key={r.id} onMouseEnter={() => setSelected(r.id)} onFocus={() => setSelected(r.id)}>
                        <ResultCard r={r} selected={focus?.id === r.id} onOpen={() => openResult(r.id)} onApply={() => applyAll(r)} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </LayoutGroup>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <Panel title={focus ? `Evidence · ${focus.testName}` : "Evidence"} right={focus && <button onClick={() => openResult(focus.id)} className="text-xs text-action hover:underline">Details</button>}>
            {!focus ? (
              <p className="text-sm text-faint">{live ? "Evidence appears here as soon as a check fails." : "Nothing failed. Every check came back clean."}</p>
            ) : (
              <div className="space-y-3">
                <p className="text-[15px] leading-snug">{focus.summary ?? focus.actual}</p>
                {focus.whyItMatters && <p className="text-sm text-muted">{focus.whyItMatters}</p>}
                {detail.data && <EvidenceList list={detail.data.evidence ?? []} compact />}
                {detail.data?.fixes?.[0] && (
                  <div className="flex gap-1.5 font-mono text-[11px]" aria-label="Fix mode">
                    {(["AUTOPILOT", "APPROVE", "OFF"] as const).map((m) => (
                      <span key={m} className={`rounded-md border px-2 py-1 ${detail.data!.fixes![0].mode === m ? "border-action/60 text-action" : "border-line text-faint"}`}>{m === "AUTOPILOT" ? "Autopilot" : m === "APPROVE" ? "Approve" : "Off"}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>
          <Panel title="Sequence health">
            {!seqHealth.length ? (
              <p className="text-sm text-faint">Scores appear when the run finishes.</p>
            ) : (
              <ul className="space-y-3">
                {seqHealth.map((s) => (
                  <li key={s.id}>
                    <Link href={`/sequences/${s.graph8Id}`} className="flex items-center gap-3 rounded-lg hover:bg-panel-2">
                      <HealthRing score={s.health!.score} size={44} stroke={4} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="truncate text-xs text-muted">{s.health!.band === "HEALTHY" ? "healthy" : s.health!.band === "AT_RISK" ? "at risk" : "broken"}{s.health!.reasons.length ? ` · ${s.health!.reasons.join(", ")}` : ""}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-1.5"><ScrollText className="h-3.5 w-3.5" />Agent log</span>}>
            <ol className="max-h-56 space-y-1 overflow-y-auto font-mono text-xs text-muted">
              {(d?.logs ?? []).slice(-60).map((l, i) => (
                <li key={i}><span className="text-faint">{new Date(l.at).toLocaleTimeString()}</span> {l.message}</li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
      <ResultDrawer resultId={open} onClose={() => openResult(null)} />
    </div>
  );
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Board id={id} />
    </Suspense>
  );
}
