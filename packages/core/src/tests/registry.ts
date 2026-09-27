import type { TestId } from "@crash/shared";
import { T11, T13, T4, T8 } from "./other";
import { T1, T2, T3, T7, T9 } from "./sell";
import type { CrashTest } from "./types";

export const REGISTRY: Partial<Record<TestId, CrashTest>> = { T1, T2, T3, T4, T7, T8, T9, T11, T13 };

/** Remedial actions change the machine; tasks and notes only record. */
export const RECORD_ONLY = new Set(["CREATE_TASK", "ADD_DEAL_NOTE"]);
