"use client";

import { FIX_LABEL, type FixAction, type FixMode, type Settings } from "@crash/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/app/providers";
import { Button, ErrorBox, Panel, Skeleton } from "@/components/ui";
import { api, patch } from "@/lib/api";
import { AREA_STYLE } from "@/lib/format";

type ModeRow = { action: FixAction; mode: FixMode };
type TestRow = { id: string; name: string; area: keyof typeof AREA_STYLE; weight: number; tier: string; enabled: boolean; blurb: string };

const MODE_HELP: Record<FixMode, string> = { AUTOPILOT: "Apply, then re-test", APPROVE: "Preview, wait for Apply", OFF: "Report only" };
const DEMO: Partial<Record<FixAction, FixMode>> = {
  PAUSE_SEQUENCE: "AUTOPILOT", WITHDRAW_CONTACT: "AUTOPILOT", ADD_SUPPRESSION: "AUTOPILOT",
  REOWN_VIA_LIST: "APPROVE", CREATE_TASK: "AUTOPILOT", ADD_DEAL_NOTE: "APPROVE",
};
const SAFE: Partial<Record<FixAction, FixMode>> = {
  PAUSE_SEQUENCE: "APPROVE", WITHDRAW_CONTACT: "APPROVE", ADD_SUPPRESSION: "APPROVE",
  REOWN_VIA_LIST: "APPROVE", CREATE_TASK: "AUTOPILOT", ADD_DEAL_NOTE: "AUTOPILOT",
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const modes = useQuery({ queryKey: ["modes"], queryFn: () => api<ModeRow[]>("/api/modes") });
  const tests = useQuery({ queryKey: ["tests"], queryFn: () => api<TestRow[]>("/api/tests") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/api/settings") });

  const setModes = useMutation({
    mutationFn: (m: ModeRow[]) => patch<ModeRow[]>("/api/modes", { modes: m }),
    onSuccess: (d) => qc.setQueryData(["modes"], d),
    onError: (e: Error) => toast({ tone: "fail", message: e.message }),
  });
  const [weightRev, setWeightRev] = useState(0);
  const setTest = useMutation({
    mutationFn: ({ id, ...b }: { id: string; enabled?: boolean; weight?: number }) => patch(`/api/tests/${id}`, b),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ["tests"] }); if (v.weight !== undefined) toast({ tone: "pass", message: `${v.id} weight saved` }); },
    onError: (e: Error) => { toast({ tone: "fail", message: e.message }); setWeightRev((n) => n + 1); qc.invalidateQueries({ queryKey: ["tests"] }); },
  });
  const setSettings = useMutation({
    mutationFn: (b: Partial<Settings>) => patch<Settings>("/api/settings", b),
    onSuccess: (d) => { qc.setQueryData(["settings"], d); toast({ tone: "pass", message: "Settings saved" }); },
    onError: (e: Error) => toast({ tone: "fail", message: e.message }),
  });
  const preset = (p: Partial<Record<FixAction, FixMode>>) => setModes.mutate(Object.entries(p).map(([action, mode]) => ({ action: action as FixAction, mode: mode! })));

  const shown: FixAction[] = ["PAUSE_SEQUENCE", "WITHDRAW_CONTACT", "ADD_SUPPRESSION", "REOWN_VIA_LIST", "CREATE_TASK", "ADD_DEAL_NOTE"];
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Settings</h1>
      {(modes.error || tests.error || settings.error) && <ErrorBox error={modes.error ?? tests.error ?? settings.error} />}

      <Panel
        title="Fix modes"
        right={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => preset(SAFE)}>Careful</Button>
            <Button size="sm" variant="outline" onClick={() => preset(DEMO)}>Demo preset</Button>
          </div>
        }
      >
        <p className="mb-4 max-w-3xl text-sm text-muted">
          The same Autopilot / Approve / Off lanes graph8 uses for AI actions. Crash Test can only ever use these actions; it never sends email to real contacts, deletes real records or edits a sent quote.
        </p>
        {modes.isLoading ? <Skeleton className="h-48" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="label px-2 py-2 font-normal">Action</th>
                  {(["AUTOPILOT", "APPROVE", "OFF"] as FixMode[]).map((m) => (
                    <th key={m} className="label px-2 py-2 text-center font-normal">{m === "AUTOPILOT" ? "Autopilot" : m === "APPROVE" ? "Approve" : "Off"}<div className="normal-case tracking-normal text-faint">{MODE_HELP[m]}</div></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((action) => {
                  const cur = modes.data?.find((m) => m.action === action)?.mode;
                  return (
                    <tr key={action} className="border-b border-line/60">
                      <td className="px-2 py-2.5">{FIX_LABEL[action]}</td>
                      {(["AUTOPILOT", "APPROVE", "OFF"] as FixMode[]).map((m) => (
                        <td key={m} className="px-2 py-2.5 text-center">
                          <button
                            role="radio"
                            aria-checked={cur === m}
                            aria-label={`${FIX_LABEL[action]}: ${m}`}
                            onClick={() => setModes.mutate([{ action, mode: m }])}
                            className={`h-8 w-24 rounded-md border text-xs transition ${cur === m ? "border-action bg-action/15 text-action" : "border-line text-faint hover:border-line-2 hover:text-ink"}`}
                          >
                            {cur === m ? (m === "AUTOPILOT" ? "Autopilot" : m === "APPROVE" ? "Approve" : "Off") : "·"}
                          </button>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Test library">
          {tests.isLoading ? <Skeleton className="h-64" /> : (
            <ul className="divide-y divide-line">
              {tests.data?.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <button
                    role="switch"
                    aria-checked={t.enabled}
                    aria-label={`${t.name} ${t.enabled ? "on" : "off"}`}
                    onClick={() => setTest.mutate({ id: t.id, enabled: !t.enabled })}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${t.enabled ? "bg-pass/80" : "bg-line-2"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${t.enabled ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                  <span className="w-9 font-mono text-xs text-faint">{t.id}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      <span className={`font-mono text-[10.5px] ${AREA_STYLE[t.area].text}`}>{AREA_STYLE[t.area].label.toUpperCase()}</span>
                      {t.tier !== "MVP" && <span className="font-mono text-[10.5px] text-faint">{t.tier}</span>}
                    </div>
                    <div className="truncate text-xs text-muted">{t.blurb}</div>
                  </div>
                  <label className="flex items-center gap-1 text-xs text-faint">
                    weight
                    <input
                      key={`${t.id}-${t.weight}-${weightRev}`}
                      type="number" min={0} max={100} step={1} defaultValue={t.weight}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const n = Number(raw);
                        // Empty, fractional or out-of-range input is put back, not saved.
                        if (!raw || !Number.isInteger(n) || n < 0 || n > 100) {
                          if (raw !== String(t.weight)) toast({ tone: "fail", message: "Weight must be a whole number from 0 to 100" });
                          e.target.value = String(t.weight);
                          return;
                        }
                        if (n !== t.weight) setTest.mutate({ id: t.id, weight: n });
                      }}
                      className="w-14 rounded-md border border-line bg-lab px-2 py-1 font-mono text-ink"
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Limits">
          {!settings.data ? <Skeleton className="h-64" /> : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setSettings.mutate({
                  maxSendsPerDay: Number(f.get("maxSendsPerDay")), maxSendsPerWeek: Number(f.get("maxSendsPerWeek")),
                  speedGoalSec: Number(f.get("speedGoalSec")), gatePollSec: Number(f.get("gatePollSec")), quoteTolerancePct: Number(f.get("quoteTolerancePct")),
                });
              }}
            >
              {([
                ["maxSendsPerDay", "Max emails per buyer per day", "T2"],
                ["maxSendsPerWeek", "Max messages per buyer per week", "T9"],
                ["speedGoalSec", "Speed-to-lead goal (seconds)", "T8"],
                ["quoteTolerancePct", "Quote vs deal tolerance (%)", "T13"],
                ["gatePollSec", "Gate check interval (seconds)", "Gate"],
              ] as const).map(([k, label, tag]) => (
                <label key={k} className="block">
                  <span className="flex justify-between text-sm"><span>{label}</span><span className="font-mono text-xs text-faint">{tag}</span></span>
                  <input name={k} type="number" step="any" defaultValue={String(settings.data![k])} className="mt-1 w-full rounded-lg border border-line bg-lab px-3 py-2 font-mono" />
                </label>
              ))}
              <div className="text-xs text-muted">Fake buyers use <span className="font-mono text-ink">@{settings.data.testDomain}</span> only.</div>
              <Button type="submit" variant="primary" loading={setSettings.isPending}>Save limits</Button>
            </form>
          )}
        </Panel>
      </div>
    </div>
  );
}
