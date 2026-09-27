import type { Area, FixAction, TestStatus } from "@crash/shared";

export const money = (n: number | null | undefined, compact = false) => {
  if (n == null) return "—";
  if (compact && Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(n >= 100000 ? 0 : n % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
};

export const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

export const duration = (a: string, b?: string | null) => {
  const s = Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export const AREA_STYLE: Record<Area, { label: string; text: string; bg: string; dot: string }> = {
  SELL: { label: "Sell", text: "text-run", bg: "bg-run/10", dot: "bg-run" },
  BOOK: { label: "Book", text: "text-book", bg: "bg-book/10", dot: "bg-book" },
  BILL: { label: "Bill", text: "text-action", bg: "bg-action/10", dot: "bg-action" },
  HYGIENE: { label: "Hygiene", text: "text-hygiene", bg: "bg-hygiene/10", dot: "bg-hygiene" },
};

export const STATUS_STYLE: Record<TestStatus, { label: string; text: string; edge: string; dot: string }> = {
  QUEUED: { label: "Queued", text: "text-muted", edge: "border-l-line-2", dot: "bg-faint" },
  RUNNING: { label: "Running", text: "text-run", edge: "border-l-run", dot: "bg-run" },
  PASS: { label: "Passed", text: "text-pass", edge: "border-l-pass", dot: "bg-pass" },
  FAIL: { label: "Failed", text: "text-fail", edge: "border-l-fail", dot: "bg-fail" },
  NEEDS_APPROVAL: { label: "Needs approval", text: "text-action", edge: "border-l-action", dot: "bg-action" },
  FIXED: { label: "Fixed", text: "text-pass", edge: "border-l-pass", dot: "bg-pass" },
  ERROR: { label: "Couldn't check", text: "text-muted", edge: "border-l-line-2", dot: "bg-faint" },
};

export const FIX_VERB: Record<FixAction, string> = {
  PAUSE_SEQUENCE: "Pause sequence",
  RESUME_SEQUENCE: "Resume sequence",
  WITHDRAW_CONTACT: "Withdraw contact",
  ADD_SUPPRESSION: "Suppress contact",
  REOWN_VIA_LIST: "Re-own leads",
  CREATE_TASK: "Create task",
  ADD_DEAL_NOTE: "Add deal note",
  CANCEL_TEST_BOOKING: "Cancel test booking",
};

/** A step's wait, e.g. "after 2d 4h", "after 45m", "immediately". */
export const delay = (minutes: number) => {
  if (!minutes) return "immediately";
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = Math.round(minutes % 60);
  return `after ${[d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ")}`;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// In a sent email any leftover {{tag}} is broken; in a template, {{tag}} is how merge fields are written.
const BROKEN = {
  rendered: [String.raw`\{\{[^}]*\}\}`, String.raw`\b(?:Hi|Hello|Hey|Dear)\s*,`, String.raw`\bundefined\b`, String.raw`\bnull\b`],
  template: [String.raw`\{\{\s*\}\}`, String.raw`\{\{(?![^{}]*\}\})`, String.raw`(?<!\{\{[^{}]*)\}\}`, String.raw`\bundefined\b`, String.raw`\bnull\b`],
};

/** Split text into plain and highlighted runs: the given needle plus broken merge tokens. */
export function highlightParts(text: string, needle?: string | null, mode: keyof typeof BROKEN = "rendered"): { t: string; hit: boolean }[] {
  const alts = [...(needle && needle.length > 1 ? [esc(needle)] : []), ...BROKEN[mode]];
  const split = new RegExp(`(${alts.join("|")})`);
  const whole = new RegExp(`^(?:${alts.join("|")})$`);
  return text.split(split).filter(Boolean).map((t) => ({ t, hit: whole.test(t) }));
}
