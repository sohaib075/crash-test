"use client";

import type { GateEventDTO, Settings, WorkspaceDTO } from "@crash/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldX, Timer } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/app/providers";
import { ErrorBox, Panel, Skeleton } from "@/components/ui";
import { api, patch } from "@/lib/api";
import { ago } from "@/lib/format";

export default function GatePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const ev = useQuery({ queryKey: ["gate"], queryFn: () => api<GateEventDTO[]>("/api/gate/events"), refetchInterval: 10_000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/api/settings") });
  const ws = useQuery({ queryKey: ["workspace"], queryFn: () => api<WorkspaceDTO | null>("/api/workspace") });
  const liveKey = ws.data ? !ws.data.sandbox : false;
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => patch("/api/gate", { enabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["workspace"] }); },
    onError: (e: Error) => toast({ tone: "fail", message: e.message }),
  });
  const on = settings.data?.gateEnabled ?? true;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Pre-flight gate</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Every {settings.data?.gatePollSec ?? 20} seconds Crash Test snapshots each live sequence. When someone (or an AI agent) edits a step, the content check runs on that sequence. {liveKey
              ? "If it fails, the change is flagged and pausing the sequence waits for your approval (live key: nothing changes by itself)."
              : "If it fails, the sequence is paused until it passes."}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          onClick={() => toggle.mutate(!on)}
          className={`ml-auto inline-flex items-center gap-3 rounded-full border px-4 py-2 text-sm ${on ? "border-pass/40 text-pass" : "border-line-2 text-muted"}`}
        >
          <span className={`relative h-5 w-9 rounded-full transition ${on ? "bg-pass/80" : "bg-line-2"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
          </span>
          Gate {on ? "on" : "off"}
        </button>
      </div>
      {ev.error && <ErrorBox error={ev.error} onRetry={() => ev.refetch()} />}
      <Panel title="Timeline">
        {ev.isLoading ? <Skeleton className="h-40" /> : ev.error && !ev.data ? (
          <p className="text-sm text-muted">The timeline couldn&apos;t be loaded.</p>
        ) : !ev.data?.length ? (
          <p className="text-sm text-muted">No changes detected yet. Edit a step in a live graph8 sequence and it will show up here within {settings.data?.gatePollSec ?? 20} seconds.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-line pl-6">
            {ev.data.map((e) => {
              const Icon = e.result === "BLOCKED" ? ShieldX : e.result === "RELEASED" ? ShieldCheck : Timer;
              const tone = e.result === "BLOCKED" ? "text-fail" : e.result === "RELEASED" ? "text-pass" : "text-run";
              return (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[33px] grid h-5 w-5 place-items-center rounded-full bg-lab ${tone}`}><Icon className="h-4 w-4" /></span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.sequenceName}</span>
                    <span className={`font-mono text-xs font-semibold ${tone}`}>{e.result}</span>
                    <span className="text-xs text-faint">{ago(e.detectedAt)}</span>
                  </div>
                  <p className="text-sm text-muted">
                    {e.result !== "CHECKING" && e.changedSteps.length > 0 && `${e.changedSteps.length === 1 ? "Step" : "Steps"} ${e.changedSteps.join(", ")} changed. `}
                    {e.message}
                  </p>
                  {e.runId && <Link href={`/runs/${e.runId}`} className="text-sm text-action hover:underline">See the check →</Link>}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
