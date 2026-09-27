// Test library, fix actions and defaults (build plan v4 §09, §19).
export const AREAS = ["SELL", "BOOK", "BILL", "HYGIENE"] as const;
export type Area = (typeof AREAS)[number];
export type RunTrigger = "MANUAL" | "GATE" | "SCHEDULE";

export const TEST_IDS = ["T1", "T2", "T3", "T4", "T7", "T8", "T9", "T11", "T13", "T14"] as const;
export type TestId = (typeof TEST_IDS)[number];

export type TestDef = {
  id: TestId;
  name: string;
  area: Area;
  weight: number;
  tier: "MVP" | "MVP+" | "CONDITIONAL";
  enabled: boolean;
  /** Needs a real send in the outbox (slow) vs reads graph8 state (fast). */
  waitsOnSends: boolean;
  blurb: string;
};

export const TEST_DEFS: TestDef[] = [
  { id: "T1", name: "Opt-out leak", area: "SELL", weight: 30, tier: "MVP", enabled: true, waitsOnSends: true, blurb: "A contact who opted out must never get an email." },
  { id: "T2", name: "Double tap", area: "SELL", weight: 15, tier: "MVP", enabled: true, waitsOnSends: true, blurb: "One buyer in two sequences gets at most one email a day." },
  { id: "T3", name: "Broken personalisation", area: "SELL", weight: 15, tier: "MVP", enabled: true, waitsOnSends: true, blurb: "No email ships with {{first_name}}, \"Hi ,\" or \"undefined\"." },
  { id: "T4", name: "Orphan lead", area: "HYGIENE", weight: 10, tier: "MVP", enabled: true, waitsOnSends: false, blurb: "Every active lead has an owner who still works here." },
  { id: "T7", name: "Content check", area: "SELL", weight: 15, tier: "MVP", enabled: true, waitsOnSends: false, blurb: "Steps have an unsubscribe line, no template leftovers, no unapproved promises." },
  { id: "T13", name: "Quote check", area: "BILL", weight: 25, tier: "MVP", enabled: true, waitsOnSends: false, blurb: "Sent quotes match their deal, have line items, aren't expired, come from a current rep." },
  { id: "T11", name: "Booking check", area: "BOOK", weight: 20, tier: "MVP+", enabled: true, waitsOnSends: false, blurb: "Booking links route to current team members and send a confirmation." },
  { id: "T8", name: "Speed-to-lead", area: "HYGIENE", weight: 10, tier: "MVP+", enabled: false, waitsOnSends: true, blurb: "A new lead on a feeding list gets a first touch within the goal." },
  { id: "T9", name: "Contact limit", area: "SELL", weight: 10, tier: "MVP+", enabled: false, waitsOnSends: false, blurb: "No buyer gets more than N messages a week across sequences." },
  { id: "T14", name: "Workflow trigger", area: "HYGIENE", weight: 10, tier: "CONDITIONAL", enabled: false, waitsOnSends: true, blurb: "Workflows fire for new buyers and their action happens." },
];
export const TEST_BY_ID = Object.fromEntries(TEST_DEFS.map((t) => [t.id, t])) as Record<TestId, TestDef>;

export const FIX_ACTIONS = [
  "PAUSE_SEQUENCE", "RESUME_SEQUENCE", "WITHDRAW_CONTACT", "ADD_SUPPRESSION",
  "REOWN_VIA_LIST", "CREATE_TASK", "ADD_DEAL_NOTE", "CANCEL_TEST_BOOKING",
] as const;
export type FixAction = (typeof FIX_ACTIONS)[number];

export const FIX_MODES = ["AUTOPILOT", "APPROVE", "OFF"] as const;
export type FixMode = (typeof FIX_MODES)[number];

export const FIX_LABEL: Record<FixAction, string> = {
  PAUSE_SEQUENCE: "Pause sequence",
  RESUME_SEQUENCE: "Resume sequence",
  WITHDRAW_CONTACT: "Withdraw contact",
  ADD_SUPPRESSION: "Add suppression",
  REOWN_VIA_LIST: "Re-own leads",
  CREATE_TASK: "Create task",
  ADD_DEAL_NOTE: "Add deal note",
  CANCEL_TEST_BOOKING: "Cancel test booking",
};

/** Seeded defaults (§19): everything APPROVE except task / note write-backs. */
export const DEFAULT_MODES: Record<FixAction, FixMode> = {
  PAUSE_SEQUENCE: "APPROVE",
  RESUME_SEQUENCE: "APPROVE",
  WITHDRAW_CONTACT: "APPROVE",
  ADD_SUPPRESSION: "APPROVE",
  REOWN_VIA_LIST: "APPROVE",
  CREATE_TASK: "AUTOPILOT",
  ADD_DEAL_NOTE: "AUTOPILOT",
  CANCEL_TEST_BOOKING: "AUTOPILOT",
};

export const DEFAULT_SETTINGS = {
  testDomain: "crashtest.example",
  maxSendsPerDay: 1,
  maxSendsPerWeek: 3,
  speedGoalSec: 300,
  gateEnabled: true,
  gatePollSec: 20,
  quoteTolerancePct: 1,
};
export type Settings = typeof DEFAULT_SETTINGS;

export const TEST_STATUSES = ["QUEUED", "RUNNING", "PASS", "FAIL", "NEEDS_APPROVAL", "FIXED", "ERROR"] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];
export const TERMINAL: TestStatus[] = ["PASS", "FAIL", "FIXED", "ERROR", "NEEDS_APPROVAL"];

export type HealthBand = "HEALTHY" | "AT_RISK" | "BROKEN";
export function band(score: number): HealthBand {
  return score >= 85 ? "HEALTHY" : score >= 60 ? "AT_RISK" : "BROKEN";
}
