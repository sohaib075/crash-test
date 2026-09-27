"use client";

import type { ReportDTO } from "@crash/shared";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HealthRing, Panel, StatTile, StatusPill } from "./ui";
import { money } from "@/lib/format";

export function ReportCard({ r }: { r: ReportDTO }) {
  const chart = r.data.byArea.map((a) => ({ area: a.area[0] + a.area.slice(1).toLowerCase(), Failures: a.failures, Fixed: a.fixed, Passed: Math.max(0, a.tests - a.failures) }));
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-panel px-6 py-5">
        <div className="label">{new Date(r.periodStart).toLocaleDateString()} – {new Date(r.periodEnd).toLocaleDateString()}</div>
        <p className="mt-2 max-w-3xl text-lg leading-relaxed">{r.summary}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Tests run" value={r.testsRun} />
        <StatTile label="Problems found" value={r.failures} tone={r.failures ? "text-fail" : ""} />
        <StatTile label="Fixed & re-tested" value={r.autoFixed} tone="text-pass" />
        <StatTile label="Leads protected" value={r.leadsProtected} />
        <StatTile label="Pipeline protected" value={r.pipelineSaved} format={(n) => money(n, true)} tone="text-action" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="By area">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={chart} barGap={2}>
                <XAxis dataKey="area" stroke="var(--faint)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--faint)" fontSize={12} tickLine={false} axisLine={false} width={24} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 8 }} />
                <Bar dataKey="Passed" stackId="a" fill="var(--line-2)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Fixed" stackId="a" fill="var(--pass)" isAnimationActive={false} />
                <Bar dataKey="Failures" stackId="b" fill="var(--fail)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Sequence health">
          {!r.data.health.length ? <p className="text-sm text-faint">No scores yet.</p> : (
            <ul className="grid grid-cols-2 gap-3">
              {r.data.health.map((h) => (
                <li key={h.name} className="flex items-center gap-3"><HealthRing score={h.score} size={44} stroke={4} /><span className="truncate text-sm">{h.name}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Top issues">
        {!r.data.topIssues.length ? <p className="text-sm text-faint">Nothing to report.</p> : (
          <ul className="divide-y divide-line">
            {r.data.topIssues.map((i, k) => (
              <li key={k} className="flex flex-wrap items-center gap-3 py-2.5">
                <StatusPill status={i.status} />
                <span className="font-medium">{i.testName}</span>
                <span className="text-muted">{i.target}</span>
                <span className="w-full text-sm text-muted sm:w-auto sm:flex-1">{i.summary}</span>
                {i.pipelineAtRisk > 0 && <span className="font-mono text-sm text-action">{money(i.pipelineAtRisk)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
