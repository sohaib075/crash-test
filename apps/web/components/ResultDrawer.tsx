"use client";

import type { FixDTO, ResultDTO } from "@crash/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ExternalLink, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/app/providers";
import { api, post } from "@/lib/api";
import { FIX_VERB, money } from "@/lib/format";
import { EvidenceList } from "./Evidence";
import { AreaTag, Button, ErrorBox, Skeleton, StatusPill } from "./ui";

function Json({ v }: { v: unknown }) {
  if (v == null) return <span className="text-faint">—</span>;
  if (typeof v !== "object") return <span>{String(v)}</span>;
  return (
    <dl className="space-y-0.5">
      {Object.entries(v as Record<string, unknown>).map(([k, x]) => (
        <div key={k} className="flex gap-2">
          <dt className="text-faint">{k}</dt>
          <dd className="truncate">{Array.isArray(x) ? (x.length ? x.join(", ") : "none") : typeof x === "object" && x ? `${Object.keys(x).length} items` : String(x)}</dd>
        </div>
      ))}
    </dl>
  );
}

function FixRow({ f, onDone }: { f: FixDTO; onDone: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const apply = useMutation({ mutationFn: () => post(`/api/fixes/${f.id}/apply`), onSuccess: () => { toast({ tone: "info", message: `Applying: ${FIX_VERB[f.action]}` }); onDone(); }, onError: (e: Error) => toast({ tone: "fail", message: e.message }) });
  const reject = useMutation({ mutationFn: () => post(`/api/fixes/${f.id}/reject`), onSuccess: onDone, onError: (e: Error) => { toast({ tone: "fail", message: e.message }); onDone(); } });
  const undo = useMutation({ mutationFn: () => post(`/api/fixes/${f.id}/undo`), onSuccess: () => { toast({ tone: "info", message: `Undone: ${FIX_VERB[f.action]}` }); setConfirm(false); onDone(); }, onError: (e: Error) => toast({ tone: "fail", message: e.message }) });
  const statusText = { PROPOSED: "Waiting for approval", APPLIED: "Applied", REJECTED: f.mode === "OFF" ? "Off: report only" : "Skipped", UNDONE: "Undone", FAILED: "Failed" }[f.status];
  const tone = { PROPOSED: "text-action", APPLIED: "text-pass", REJECTED: "text-faint", UNDONE: "text-muted", FAILED: "text-fail" }[f.status];
  return (
    <div className={`rounded-xl border p-4 ${f.status === "PROPOSED" ? "border-action/50 bg-action/[0.04]" : "border-line-2 bg-lab"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{FIX_VERB[f.action]}</span>
        <span className="rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{f.mode}</span>
        <span className={`ml-auto text-xs ${tone}`}>{statusText}</span>
      </div>
      <p className="mt-1.5 text-sm text-muted">{f.preview}</p>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 font-mono text-xs">
        <div className="rounded-lg border border-line bg-panel p-2.5"><div className="label mb-1">Before</div><Json v={f.before} /></div>
        <ArrowRight className="h-4 w-4 self-center text-faint" />
        <div className="rounded-lg border border-line bg-panel p-2.5"><div className="label mb-1">{f.status === "PROPOSED" ? "After (planned)" : "After"}</div><Json v={f.after} /></div>
      </div>
      {f.error && <p className={`mt-2 text-xs ${f.status === "UNDONE" ? "text-muted" : "text-fail"}`}>{f.error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {f.status === "PROPOSED" && (
          <>
            <Button variant="primary" size="sm" loading={apply.isPending} onClick={() => apply.mutate()}>Apply fix</Button>
            <Button variant="ghost" size="sm" loading={reject.isPending} onClick={() => reject.mutate()}>Skip</Button>
          </>
        )}
        {f.status === "FAILED" && (
          <Button variant="outline" size="sm" loading={apply.isPending} onClick={() => apply.mutate()}>Retry fix</Button>
        )}
        {f.status === "APPLIED" && !confirm && (
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}><RotateCcw className="h-3.5 w-3.5" /> Undo fix</Button>
        )}
        {f.status === "APPLIED" && confirm && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm">
            <span>Put graph8 back to &quot;before&quot;?</span>
            <Button variant="danger" size="sm" loading={undo.isPending} onClick={() => undo.mutate()}>Yes, undo</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        )}
        <span className="ml-auto text-xs text-faint">{f.reason}</span>
      </div>
    </div>
  );
}

export function ResultDrawer({ resultId, onClose }: { resultId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const panel = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["result", resultId], queryFn: () => api<ResultDTO>(`/api/results/${resultId}`), enabled: !!resultId });
  const retest = useMutation({
    mutationFn: () => post(`/api/results/${resultId}/retest`),
    onSuccess: () => { toast({ tone: "info", message: "Re-testing…" }); refresh(); },
    onError: (e: Error) => toast({ tone: "fail", message: e.message }),
  });
  // Keep the latest onClose without re-running the focus effect (which would steal focus on every re-render).
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  // Focus trap + Escape (§15 accessibility).
  useEffect(() => {
    if (!resultId) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key !== "Tab" || !panel.current) return;
      const f = panel.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      // Focus can fall out of the panel when the focused button unmounts (e.g. after "Yes, undo").
      if (!panel.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [resultId]);

  const r = q.data;
  function refresh() {
    qc.invalidateQueries({ queryKey: ["result", resultId] });
    if (r) qc.invalidateQueries({ queryKey: ["run", r.runId] });
  }
  const busy = r?.status === "RUNNING" || r?.status === "QUEUED" || r?.retestStatus === "QUEUED";

  // No exit animation: an overlay that waits on an animation frame to leave can
  // stay invisible on top of the board (paused rAF) and swallow every click.
  if (!resultId) return null;
  return (
        <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose}>
          <motion.aside
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Result details"
            onClick={(e) => e.stopPropagation()}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="h-full w-full max-w-[640px] overflow-y-auto border-l border-line-2 bg-panel outline-none"
          >
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel/95 px-6 py-3 backdrop-blur">
              {r && <AreaTag area={r.area} />}
              {r && <StatusPill status={r.status} />}
              <button onClick={onClose} className="ml-auto rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-6 px-6 py-5">
              {q.isLoading && <div className="space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-20" /><Skeleton className="h-48" /></div>}
              {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
              {r && (
                <>
                  <div>
                    <div className="font-mono text-xs text-faint">{r.testId} · {r.testName} · {r.targetName}</div>
                    <h2 className="mt-2 font-display text-[22px] leading-snug font-bold">{r.summary ?? r.actual}</h2>
                    {r.status === "FIXED" && r.problem && <p className="mt-2 text-sm"><span className="label mr-2">Problem was</span>{r.problem}</p>}
                    {r.whyItMatters && <p className="mt-2 text-muted">{r.whyItMatters}</p>}
                    <div className="mt-4 flex flex-wrap gap-2 font-mono text-sm">
                      {(r.leadsAffected ?? 0) > 0 && <span className="rounded-lg border border-line-2 px-2.5 py-1">{r.leadsAffected} leads {r.status === "FIXED" ? "protected" : "affected"}</span>}
                      {(r.pipelineAtRisk ?? 0) > 0 && <span className="rounded-lg border border-action/40 px-2.5 py-1 text-action">{money(r.pipelineAtRisk)} of open pipeline</span>}
                    </div>
                  </div>

                  <section>
                    <h3 className="label mb-2">Evidence</h3>
                    <EvidenceList list={r.evidence ?? []} />
                  </section>

                  <section>
                    <h3 className="label mb-2">What we checked</h3>
                    <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
                      <dt className="text-faint">Expected</dt><dd>{r.expected}</dd>
                      <dt className="text-faint">Actual</dt><dd>{r.actual ?? "—"}</dd>
                      {r.error && <><dt className="text-faint">Problem</dt><dd className="text-action">{r.error}</dd></>}
                    </dl>
                  </section>

                  {!!r.fixes?.length && (
                    <section>
                      <h3 className="label mb-2">Fix</h3>
                      <div className="grid gap-3">
                        {r.fixes.map((f) => <FixRow key={f.id} f={f} onDone={refresh} />)}
                      </div>
                    </section>
                  )}

                  {!!r.writebacks?.length && (
                    <section className="rounded-xl border border-pass/30 bg-pass/5 px-4 py-3 text-sm">
                      {r.writebacks.map((w) => (
                        <div key={w.kind} className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-pass" />
                          Written back to graph8 as a {w.kind === "deal_note" ? "deal note" : w.kind} <span className="font-mono text-xs text-faint">{w.graph8Id}</span>
                          <ExternalLink className="ml-auto h-3.5 w-3.5 text-faint" />
                        </div>
                      ))}
                    </section>
                  )}

                  <div className="flex gap-2 border-t border-line pt-4">
                    <Button size="sm" variant="outline" loading={retest.isPending} disabled={busy} onClick={() => retest.mutate()}>{busy ? "Running…" : "Re-run this test"}</Button>
                  </div>
                </>
              )}
            </div>
          </motion.aside>
        </motion.div>
  );
}
