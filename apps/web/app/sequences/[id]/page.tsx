"use client";

import type { SequenceDTO, TestStatus } from "@crash/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorBox, HealthRing, Panel, Skeleton, StatusPill } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, highlightParts } from "@/lib/format";

type Detail = SequenceDTO & {
  history: { id: string; runId: string; testId: string; testName: string; status: TestStatus; summary: string | null; at: string }[];
  gate: { id: string; result: string; message: string | null; detectedAt: string; changedSteps: number[] }[];
};

export default function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["sequence", id], queryFn: () => api<Detail>(`/api/sequences/${id}`) });
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const s = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-5">
        <HealthRing score={s.health?.score ?? null} size={88} stroke={7} />
        <div>
          <Link href="/" className="text-sm text-muted hover:text-ink">← Workspace</Link>
          <h1 className="font-display text-3xl font-bold">{s.name}</h1>
          <p className="text-sm text-muted">{s.status} · {s.steps.length} steps · sends as {s.senderEmails.join(", ") || "?"}</p>
          {s.health && <p className="mt-1 text-sm">{s.health.reasons.length ? `Problems: ${s.health.reasons.join(", ")}` : "No problems in the last run."}</p>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Steps">
          <ol className="space-y-3">
            {s.steps.map((st) => (
              <li key={st.id || st.order} className="rounded-xl border border-line bg-lab/60 p-4">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="font-mono">Step {st.order}</span> · {st.type} · {st.delayMinutes ? `after ${Math.round(st.delayMinutes / 60)}h` : "immediately"}
                </div>
                {st.subject && <div className="mt-1 font-medium">{highlightParts(st.subject).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.t}</mark> : <span key={i}>{p.t}</span>))}</div>}
                {st.body && <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{highlightParts(st.body).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.t}</mark> : <span key={i}>{p.t}</span>))}</p>}
              </li>
            ))}
          </ol>
        </Panel>
        <div className="space-y-6">
          <Panel title="Health trend">
            {s.trend.length < 2 ? <p className="text-sm text-faint">A trend appears after two runs.</p> : (
              <div className="h-44">
                <ResponsiveContainer>
                  <LineChart data={s.trend.map((t) => ({ ...t, label: new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }))}>
                    <XAxis dataKey="label" stroke="var(--faint)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} stroke="var(--faint)" fontSize={12} tickLine={false} axisLine={false} width={28} />
                    <Tooltip contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 8 }} />
                    <Line type="monotone" dataKey="score" stroke="var(--action)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
          <Panel title="History">
            {!s.history.length ? <p className="text-sm text-faint">Not tested yet.</p> : (
              <ul className="space-y-2">
                {s.history.map((h) => (
                  <li key={h.id}>
                    <Link href={`/runs/${h.runId}?result=${h.id}`} className="flex items-start gap-3 rounded-lg p-1.5 hover:bg-panel-2">
                      <StatusPill status={h.status} />
                      <div className="min-w-0 text-sm">
                        <div>{h.testName}</div>
                        <div className="truncate text-xs text-muted">{h.summary}</div>
                      </div>
                      <span className="ml-auto shrink-0 text-xs text-faint">{ago(h.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
