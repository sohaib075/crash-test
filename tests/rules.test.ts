// §25: T3 patterns, T7 fixed rules, exact-substring check, T13 comparison, money/score maths.
import { describe, expect, it } from "vitest";
import { extractJson, keywordPromises, templateExplain, templateReport } from "@crash/ai";
import { band } from "@crash/shared";
import { brokenMergeHits, contentIssues, maxSendsInWindow, quoteProblems } from "../packages/core/src/tests/rules";
import { normOutbox, normQuote } from "../packages/core/src/graph8/normalize";

describe("T3 merge fields", () => {
  it("flags raw tags, empty greetings and null-ish values", () => {
    expect(brokenMergeHits("Hi {{first_name}}, hello")[0]).toBe("{{first_name}}");
    expect(brokenMergeHits("Hi , noticed your team")).toEqual(["Hi ,"]);
    expect(brokenMergeHits("Welcome undefined")).toEqual(["undefined"]);
  });
  it("passes clean copy", () => {
    expect(brokenMergeHits("Hi there, thanks. Nullable types are great.")).toEqual([]);
  });
});

describe("T2/T9 windows", () => {
  const e = (to: string, sentAt: string) => ({ outboxId: sentAt, to, from: "", subject: "", sentAt, body: "", raw: {} });
  it("counts the peak inside a rolling window", () => {
    const ev = [e("a@x.test", "2026-09-27T10:00:00Z"), e("a@x.test", "2026-09-27T10:05:00Z"), e("a@x.test", "2026-09-28T11:00:00Z")];
    expect(maxSendsInWindow(ev, "a@x.test", 864e5)).toBe(2);
    expect(maxSendsInWindow(ev, "a@x.test", 7 * 864e5)).toBe(3);
  });
});

describe("T7 content", () => {
  it("needs an unsubscribe line and no template leftovers", () => {
    expect(contentIssues("Hi there, [Insert case study]. Thanks", true).map((i) => i.rule)).toEqual(["unsubscribe", "leftover"]);
    expect(contentIssues("Hi there. Unsubscribe: {{unsubscribe_link}}", true)).toEqual([]);
  });
  it("keyword promises quote the exact sentence", () => {
    const text = "Quick follow-up. If you sign this month we guarantee 50% off your first year. Worth a call?";
    const [f] = keywordPromises(text);
    expect(f.quote).toBe("If you sign this month we guarantee 50% off your first year.");
    expect(text.includes(f.quote)).toBe(true);
  });
});

describe("T13 quotes", () => {
  const base = { total: 12000, dealAmount: 15000, lineItemCount: 2, expiresAt: null, recipientSuppressed: false, senderActive: true, tolerancePct: 1 };
  it("flags a total that doesn't match the deal", () => {
    expect(quoteProblems(base)[0].message).toBe("says $12,000. The deal says $15,000.");
  });
  it("allows 1% tolerance and flags expiry, empty lines, departed sender", () => {
    expect(quoteProblems({ ...base, total: 14900 })).toEqual([]);
    const codes = quoteProblems({ ...base, total: 15000, lineItemCount: 0, expiresAt: "2020-01-01", senderActive: false }).map((p) => p.code);
    expect(codes).toEqual(["no_line_items", "expired", "sender_departed"]);
  });
  it("computes totals from cent line items when the quote has none", () => {
    const q = normQuote({ id: "q", quote_number: "Q-1", line_items: [{ unit_amount: 500000, quantity: 2 }, { unit_amount: 200000, quantity: 1, discount_pct: 50 }] });
    expect(q.total).toBe(11000);
    expect(q.lineItemCount).toBe(2);
  });
});

describe("money, score and copy", () => {
  it("health bands", () => {
    expect([band(94), band(70), band(40)]).toEqual(["HEALTHY", "AT_RISK", "BROKEN"]);
  });
  it("plain-English microcopy (§14)", () => {
    expect(templateExplain("T1", { buyer: "Dana Okafor", sends: 2, sequence: "Q4 Outbound" }).summary).toBe("Dana Okafor opted out but got 2 emails from Q4 Outbound.");
    expect(templateExplain("T13", { quote: "Q-1042", problem: "says $12,000. The deal says $15,000." }).summary).toBe("Quote Q-1042 says $12,000. The deal says $15,000.");
    expect(templateReport({ testsRun: 21, failures: 4, autoFixed: 3, leadsProtected: 41, pipelineSaved: 48000 })).toContain("$48,000");
  });
  it("extracts JSON from copilot prose", () => {
    expect(extractJson('Sure! ```json\n{"a":"b {c}"}\n```')).toEqual({ a: "b {c}" });
    expect(extractJson('[{"quote":"x"}] done')).toEqual([{ quote: "x" }]);
  });
  it("normalizes outbox items", () => {
    const n = normOutbox({ id: 7, recipient: { email: "T1@X.test" }, sender_email: "rep@co.test", subject: "Hi", html: "<p>Hi {{first_name}}</p>", created_at: "2026-09-27T10:00:00Z" });
    expect(n).toMatchObject({ outboxId: "7", to: "t1@x.test", from: "rep@co.test", body: "Hi {{first_name}}" });
  });
});

describe("evidence highlighting (web)", async () => {
  const { highlightParts, money } = await import("../apps/web/lib/format");
  it("marks the quoted sentence and broken tokens only", () => {
    const parts = highlightParts("Hi , noticed {{company}} grew. We guarantee 50% off (today).", "We guarantee 50% off (today).");
    expect(parts.filter((p) => p.hit).map((p) => p.t)).toEqual(["Hi ,", "{{company}}", "We guarantee 50% off (today)."]);
    expect(parts.map((p) => p.t).join("")).toBe("Hi , noticed {{company}} grew. We guarantee 50% off (today).");
  });
  it("formats money compactly", () => {
    expect(money(48000, true)).toBe("$48k");
    expect(money(12000)).toBe("$12,000");
  });
});
