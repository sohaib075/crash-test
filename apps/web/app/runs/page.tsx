"use client";

import type { RunTotals } from "@crash/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ErrorBox, Panel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, duration, money } from "@/lib/format";

type Row = { id: string; trigger: string; status: string; startedAt: string; finishedAt: string | null; totals: RunTotals };

export default function RunsPage() {
  const q = useQuery({ queryKey: ["runs"], queryFn: () => api<Row[]>("/api/runs?limit=50"), refetchInterval: 10_000 });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Runs</h1>
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <Panel pad={false}>
        {q.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : q.error && !q.data ? (
          <p className="p-6 text-sm text-muted">Runs couldn&apos;t be loaded.</p>
        ) : !q.data?.length ? (
          <p className="p-6 text-sm text-muted">No runs yet. Press &quot;Run all tests&quot; on the Workspace page.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left">
                <tr className="border-b border-line">
                  {["Started", "Trigger", "Status", "Tests", "Failed", "Fixed", "Leads protected", "Pipeline at risk", "Took"].map((h) => (
                    <th key={h} className="label px-4 py-2.5 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 hover:bg-panel-2">
                    <td className="px-4 py-2.5"><Link href={`/runs/${r.id}`} className="hover:text-action">{ago(r.startedAt)}</Link></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.trigger === "GATE" ? <span className="text-fail">GATE</span> : r.trigger}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.status}</td>
                    <td className="px-4 py-2.5 font-mono">{r.totals.tests}</td>
                    <td className="px-4 py-2.5 font-mono text-fail">{r.totals.fail + r.totals.needsApproval || ""}</td>
                    <td className="px-4 py-2.5 font-mono text-pass">{r.totals.fixed || ""}</td>
                    <td className="px-4 py-2.5 font-mono">{r.totals.leadsProtected}</td>
                    <td className="px-4 py-2.5 font-mono text-action">{money(r.totals.pipelineAtRisk)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted">{duration(r.startedAt, r.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
