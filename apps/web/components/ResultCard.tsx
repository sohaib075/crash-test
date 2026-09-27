"use client";

import type { ResultDTO } from "@crash/shared";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { AreaTag } from "./ui";
import { money, STATUS_STYLE } from "@/lib/format";

export function ResultCard({ r, selected, onOpen, onApply, applying }: { r: ResultDTO; selected?: boolean; onOpen: () => void; onApply?: () => void; applying?: boolean }) {
  const s = STATUS_STYLE[r.status];
  const running = r.status === "RUNNING" || r.status === "QUEUED";
  const pending = r.fixes?.filter((f) => f.status === "PROPOSED" && f.mode === "APPROVE") ?? [];
  const recorded = (r.writebacks?.length ?? 0) > 0 && (r.status === "FAIL" || r.status === "NEEDS_APPROVAL");
  const line =
    r.status === "RUNNING" && r.retestStatus === "RUNNING" ? "Re-testing…"
    : r.status === "RUNNING" && r.fixes?.some((f) => f.status === "APPLIED" || f.appliedAt || (f.status === "PROPOSED" && f.mode === "AUTOPILOT")) ? "Applying fix…"
    : r.status === "RUNNING" ? "Checking…"
    : r.status === "QUEUED" ? "Waiting to start"
    : r.status === "ERROR" ? r.error ?? "Couldn't check"
    : r.summary ?? r.actual ?? "";
  // The card is a focusable container (not a <button>) so the Apply button
  // inside it is a real, separately focusable button.
  return (
    <motion.div
      layout
      layoutId={r.id}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${r.testName} on ${r.targetName}: ${s.label}. Open details`}
      className={`group w-full cursor-pointer rounded-xl border border-l-[3px] bg-panel p-3 text-left transition hover:bg-panel-2 ${s.edge} ${selected ? "border-action/60 ring-1 ring-action/40" : "border-line"} ${running ? "pulse" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <AreaTag area={r.area} />
        <span className={`text-[11px] font-medium ${s.text}`}>{s.label}</span>
      </div>
      <div className="mt-1 font-display text-[15px] font-semibold leading-snug">{r.testName}</div>
      <div className="truncate text-[13px] text-muted">{r.targetName}</div>
      {line && <p className={`mt-1.5 line-clamp-2 text-[13px] leading-snug ${r.status === "FAIL" || r.status === "NEEDS_APPROVAL" ? "text-ink" : "text-muted"}`}>{line}</p>}
      {(r.pipelineAtRisk ?? 0) > 0 && r.status !== "PASS" && (
        <div className="mt-2 font-mono text-[13px] text-action">{money(r.pipelineAtRisk)} of open pipeline</div>
      )}
      {recorded && (
        <div className="mt-2 inline-flex items-center gap-1 text-xs text-pass">
          <CheckCircle2 className="h-3.5 w-3.5" /> Recorded in graph8
        </div>
      )}
      {r.status === "NEEDS_APPROVAL" && pending.length > 0 && onApply && (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            disabled={applying}
            aria-busy={applying}
            onClick={(e) => {
              e.stopPropagation();
              onApply();
            }}
            className="inline-flex h-7 items-center rounded-md bg-action px-2.5 text-xs font-semibold text-black hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {applying ? "Applying…" : "Apply fix"}
          </button>
          <span className="inline-flex h-7 items-center rounded-md px-2 text-xs text-muted group-hover:text-ink">Details</span>
        </div>
      )}
    </motion.div>
  );
}
