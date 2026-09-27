import { z } from "zod";
import { askJson } from "./llm";

export type ReportNumbers = { testsRun: number; failures: number; autoFixed: number; leadsProtected: number; pipelineSaved: number; topIssue?: string };

export function templateReport(n: ReportNumbers) {
  const money = `$${Math.round(n.pipelineSaved).toLocaleString("en-US")}`;
  const s = n.failures === 1 ? "" : "s";
  return [
    `Crash Test ran ${n.testsRun} checks across selling, booking and billing and found ${n.failures} problem${s}.`,
    `${n.autoFixed} were fixed and re-tested, protecting ${n.leadsProtected} leads and ${money} of open pipeline.`,
    n.topIssue ? `Top issue: ${n.topIssue}` : "Nothing needs your attention right now.",
  ].join(" ");
}

export async function reportSummary(n: ReportNumbers) {
  const base = templateReport(n);
  const r = await askJson(
    "report",
    z.object({ summary: z.string().min(40).max(600) }),
    `Write a 3-sentence Monday-morning summary for a RevOps lead. Keep every number exactly.\nFacts: ${base}`,
    () => ({ summary: base }),
  );
  const nums = [n.testsRun, n.failures, n.autoFixed, n.leadsProtected].map(String);
  return nums.every((x) => r.value.summary.includes(x)) ? r.value.summary : base;
}
