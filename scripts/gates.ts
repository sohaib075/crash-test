// Go / no-go gate (build plan v4 §03). `npm run gates [-- --seq <sequenceId>]`
// Decision: if G1 (a sequence send reaches the outbox with recipient, sender
// and time) isn't green by Sun 1:00 PM, switch to Baton on the same stack.
import { buyerEmail, call, config, getBackend } from "@crash/core";
import { g8 } from "@graph8/sdk";

type Row = { id: string; name: string; ok: boolean | null; detail: string };
const rows: Row[] = [];
const add = (id: string, name: string, ok: boolean | null, detail: string) => {
  rows.push({ id, name, ok, detail });
  console.log(`${ok === true ? "PASS" : ok === false ? "FAIL" : "INFO"}  ${id.padEnd(4)} ${name}: ${detail}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (k: string) => (process.argv.indexOf(k) > 0 ? process.argv[process.argv.indexOf(k) + 1] : undefined);

async function main() {
  const b = getBackend();
  if (!config.apiKey) throw new Error("GRAPH8_API_KEY is not set in .env");

  const st = await b.sandboxStatus();
  add("G0", "Sandbox workspace", st.sandbox, `sandbox=${st.sandbox} org=${st.workspaceId}`);
  if (!st.sandbox) return;

  const ws = await b.discover();
  add("G3", "Endpoints: sequences + steps, users, lists", ws.sequences.length > 0, `${ws.sequences.length} sequences (${ws.sequences.reduce((n, s) => n + s.steps.length, 0)} steps), ${ws.users.length} users, ${ws.lists.length} lists`);
  const q = ws.quotes[0];
  add("G7", "Quotes return total, line items, expiry, sender", ws.quotes.length ? !!(q.total != null && q.lineItemCount != null) : null,
    ws.quotes.length ? `${ws.quotes.length} sent · first: total=${q.total} lines=${q.lineItemCount} expiry=${q.expiresAt ?? "?"} sender=${q.senderEmail ?? "?"} deal=${q.dealId ?? "?"}` : "no sent quotes yet (seed one)");
  if (q) console.log("      raw quote keys:", Object.keys(q.raw).join(", "));
  add("G8", "Booking links + hosts", ws.bookingLinks.length ? ws.bookingLinks.some((l) => l.hostEmails.length > 0) : null,
    ws.bookingLinks.length ? ws.bookingLinks.map((l) => `${l.name}: ${l.hostEmails.join(", ") || "no hosts in payload"}`).join(" | ") : "no event types");
  add("G9", "Open deals with amounts", ws.deals.length ? ws.deals.some((d) => d.amount != null) : null, `${ws.deals.length} open deals, ${ws.deals.filter((d) => d.contactIds.length).length} linked to contacts`);

  try {
    const u = ((await call("get_usage_usage_get")) as { data?: Record<string, unknown> }).data ?? {};
    add("G10", "Credits", null, `available=${u.available_credits ?? u.credits} used=${u.total_used}`);
  } catch (e) {
    add("G10", "Credits", null, `usage not readable (${(e as Error).message})`);
  }
  const ops = (g8.api as unknown as { operations(): { id: string; scope: string }[] }).operations();
  const used = ["sandbox_outbox_sandbox_outbox_get", "add_contacts_to_sequence_sequences__sequence_id__contacts_post", "create_contacts_contacts_post", "pause_sequence_sequences__sequence_id__pause_post", "list_quotes_quotes_get", "list_deals_deals_get", "create_deal_note_deals__deal_id__notes_post", "reassign_list_owner_lists__audience_id__owner_patch", "create_task_contacts__contact_id__tasks_post", "chat_with_copilot_copilot_chat_post"];
  add("G11", "Scopes the key needs", null, [...new Set(ops.filter((o) => used.includes(o.id)).map((o) => o.scope))].sort().join(", "));

  // G1 + G2 + G4 + G5: real send through a zero-delay sequence
  const seq = ws.sequences.find((s) => s.id === arg("--seq")) ?? ws.sequences.find((s) => /live|active/.test(s.status) && (s.steps[0]?.delayMinutes ?? 0) === 0);
  if (!seq) {
    add("G1", "Send reaches the outbox", false, "no live sequence with a zero-delay first step (npm run seed:graph8 -- --apply)");
    return;
  }
  const runId = `gate${Date.now()}`;
  const list = await b.createList(`crash-test gate ${runId}`);
  const mk = async (tag: string) => {
    const email = buyerEmail(runId, "GATE", tag);
    const id = await b.createContact({ email, firstName: "Gate", lastName: tag, company: "Gate Co", title: "Tester" }, { crash_test_run: runId });
    await b.addToList(list, [id]);
    return { id, email };
  };
  const plain = await mk("plain");
  const supp = await mk("supp");
  add("G6", "Create contact + custom field tag", true, `created ${plain.email} with crash_test_run=${runId}`);
  await b.suppress(supp.id);
  const since = new Date(Date.now() - 5000).toISOString();
  const t0 = Date.now();
  await b.enrol(seq.id, [plain.id, supp.id], list);
  console.log(`      Enrolled 2 contacts in "${seq.name}"; watching the outbox for up to ${config.outboxTimeoutMs / 1000}s…`);
  let hit, suppHit;
  while (Date.now() - t0 < config.outboxTimeoutMs) {
    const box = await b.outbox(since);
    hit ??= box.find((e) => e.to === plain.email);
    suppHit ??= box.find((e) => e.to === supp.email);
    if (hit) break;
    await sleep(config.outboxPollMs);
  }
  add("G1", "Zero-delay send appears in the outbox", !!hit, hit ? `after ~${Math.round((Date.now() - t0) / 1000)}s` : "not seen in the time window");
  add("G2", "Outbox item has recipient, sender, subject, body, time", !!hit && !!(hit.to && hit.from && hit.subject && hit.sentAt && hit.body),
    hit ? `to=${hit.to} from=${hit.from || "?"} subject=${hit.subject ? "yes" : "no"} body=${hit.body ? "yes" : "no"} time=${hit.sentAt || "?"}` : "n/a");
  if (hit) console.log("      raw outbox keys:", Object.keys(hit.raw).join(", "));
  add("G4", "Suppressed contact enrolled", null, suppHit ? "graph8 SENT to the suppressed contact (T1 will catch this live)" : "no send to the suppressed contact (graph8 honours suppressions)");

  let cleaned = true;
  for (const c of [plain, supp]) {
    await b.withdraw([c.id]).catch(() => (cleaned = false));
    await b.reinstate(c.id).catch(() => {});
    await b.deleteContact(c.id).catch(() => (cleaned = false));
  }
  await b.deleteList(list).catch(() => {});
  add("G5", "Withdraw + delete test contacts", cleaned, cleaned ? "ok" : "delete failed: fall back to withdraw + suppress + tagged");
}

main()
  .then(() => {
    const go = rows.find((r) => r.id === "G0")?.ok && rows.find((r) => r.id === "G1")?.ok;
    console.log(`\n${go ? "GO: the outbox works. Continue with Crash Test." : "NO-GO: if not fixed by Sun 1:00 PM, switch to Baton on the same stack."}`);
    process.exit(go ? 0 : 1);
  })
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
