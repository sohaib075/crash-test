// Live events: worker → Postgres NOTIFY → server → Socket.IO → browser (§20).
import type { Area, FixAction, HealthBand, TestId, TestStatus } from "./constants";

export type LiveEvent =
  | { type: "run:updated"; runId: string; status: string }
  | { type: "result:updated"; runId: string; resultId: string; testId: TestId; area: Area; status: TestStatus; summary?: string | null }
  | { type: "fix:proposed"; runId: string; fixId: string; resultId: string; action: FixAction }
  | { type: "fix:applied"; runId: string; fixId: string; resultId: string }
  | { type: "fix:undone"; runId: string; fixId: string; resultId: string }
  | { type: "gate:blocked"; sequenceId: string; name: string; runId?: string; resultId?: string; message: string }
  | { type: "gate:released"; sequenceId: string; name: string }
  | { type: "gate:checking"; sequenceId: string; name: string; runId: string }
  | { type: "health:updated"; sequenceId: string; score: number; band: HealthBand }
  | { type: "log"; runId: string; message: string; at: string }
  | { type: "toast"; tone: "fail" | "pass" | "info"; message: string; runId?: string; resultId?: string };

export const CHANNEL = "crash_events";
