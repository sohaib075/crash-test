"use client";

import type { ReadyDTO } from "@crash/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleX, RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/app/providers";
import { Button, ErrorBox, Panel, Skeleton } from "@/components/ui";
import { api, post } from "@/lib/api";

/** Demo readiness (§07): green on every line or we don't start. */
export default function ReadyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ["ready"], queryFn: () => api<ReadyDTO>("/api/ready"), refetchInterval: 15_000 });
  const reset = useMutation({
    mutationFn: () => post<{ ok: boolean; log: string[] }>("/api/demo/reset"),
    onSuccess: (d) => {
      setConfirm(false);
      d.log.forEach((m) => toast({ tone: "info", message: m }));
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast({ tone: "fail", message: e.message }),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Demo readiness</h1>
          <p className="text-sm text-muted">Green on every line, or we don&apos;t start the demo.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => q.refetch()} loading={q.isFetching}><RefreshCw className="h-4 w-4" /> Re-check</Button>
          {!confirm ? (
            <Button variant="primary" onClick={() => setConfirm(true)}><RotateCcw className="h-4 w-4" /> Reset demo</Button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-1.5 text-sm">
              Clean up buyers and undo every fix?
              <Button size="sm" variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>Reset</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            </div>
          )}
        </div>
      </div>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <Panel pad={false}>
        {q.isLoading ? <div className="space-y-2 p-5">{[...Array(7)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div> : (
          <ul className="divide-y divide-line">
            {q.data?.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-5 py-3.5">
                {c.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-pass" /> : <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-fail" />}
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className={`text-sm ${c.ok ? "text-muted" : "text-fail"}`}>{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {q.data && (
        <div className={`rounded-2xl border px-5 py-4 text-center font-display text-lg font-semibold ${q.data.ok ? "border-pass/40 bg-pass/5 text-pass" : "border-action/40 bg-action/5 text-action"}`}>
          {q.data.ok ? "Ready. Go." : `${q.data.checks.filter((c) => !c.ok).length} check${q.data.checks.filter((c) => !c.ok).length === 1 ? "" : "s"} to fix before the demo`}
        </div>
      )}
    </div>
  );
}
