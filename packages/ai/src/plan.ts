// Planner: which tests run against which targets. The AI can only choose among
// code-generated candidates; fallback = every enabled test on every target.
import { z } from "zod";
import { askJson } from "./llm";

export type Candidate = { testId: string; targetType: string; targetId: string; targetName: string; why: string };

const Schema = z.object({ tests: z.array(z.object({ testId: z.string(), targetId: z.string(), why: z.string() })) });

export async function plan(candidates: Candidate[], workspaceSummary: string) {
  const byKey = new Map(candidates.map((c) => [`${c.testId}|${c.targetId}`, c]));
  const r = await askJson(
    "plan",
    Schema,
    `You are the planner of a QA agent for a graph8 revenue workspace. Choose which checks to run. Cover every live sequence, every sent quote, and the riskiest pairs for double-tap. Only choose from the candidate list. One short reason each.\n\nWorkspace:\n${workspaceSummary}\n\nCandidates (testId|targetId, name):\n${candidates.map((c) => `${c.testId}|${c.targetId}, ${c.targetName}`).join("\n")}`,
    () => ({ tests: candidates.map((c) => ({ testId: c.testId, targetId: c.targetId, why: c.why })) }),
  );
  const picked: Candidate[] = [];
  const seen = new Set<string>();
  for (const t of r.value.tests) {
    const k = `${t.testId}|${t.targetId}`;
    const c = byKey.get(k);
    if (c && !seen.has(k)) {
      seen.add(k);
      picked.push({ ...c, why: t.why || c.why });
    }
  }
  // Safety net: never drop a whole test type the AI forgot.
  for (const c of candidates) if (!picked.some((p) => p.testId === c.testId)) picked.push(c);
  return { tests: picked.length ? picked : candidates, source: picked.length ? r.source : "rules" };
}
