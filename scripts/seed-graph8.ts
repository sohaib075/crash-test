// Seed the demo workspace on graph8 (build plan v4 §28 "Demo data in graph8").
//   npm run seed:graph8            → dry run: prints every payload, calls nothing
//   npm run seed:graph8 -- --apply → creates it in the SANDBOX (refuses otherwise)
//
// Creates: 3 sequences (1 healthy, 2 with planted problems), prospects, an open
// deal with a SENT quote whose total is wrong, and 2 leads with no owner.
//   Q4 Outbound      "Hi {{first_name}}," with no fallback            → T3
//                    step 2 "we guarantee 50% off your first year"   → T7
//   Q4 + Re-engage   same audience, no cross-sequence cap             → T2
//   Quote Q-…        $12,000 on a $15,000 deal                        → T13
//   2 prospects      no owner                                         → T4
// Opt-outs (T1) depend on workspace settings; `npm run gates` G4 tells you.
import { call, config } from "@crash/core";

const apply = process.argv.includes("--apply");
const owner = process.env.DEMO_OWNER_EMAIL ?? "";
const PROSPECTS = "northwind-demo.example"; // sandbox prospects, NOT the fake-buyer TEST_DOMAIN

type Any = Record<string, unknown>;
const step = (order: number, subject: string, body: string, delaySec = 0) => ({
  step_order: order, step_type: "EMAIL", input_type: "MANUAL_TEMPLATE", step_data: { subject, body }, time_interval: delaySec,
});
const UNSUB = "\n\nNot interested? Unsubscribe: {{unsubscribe_link}}";

async function doCall(label: string, op: string, input: Any) {
  if (!apply) {
    console.log(`\n[dry run] ${label}\n${JSON.stringify(input, null, 1)}`);
    return { data: { id: "dry-run", contact_id: 0 } } as Any;
  }
  const r = (await call(op, input)) as Any;
  const d = (r.data ?? r) as Any;
  console.log(`✓ ${label}: ${d.id ?? d.contact_id ?? "ok"}`);
  return r;
}

async function main() {
  if (!config.apiKey) throw new Error("GRAPH8_API_KEY is not set in .env");
  if (!owner) throw new Error("Set DEMO_OWNER_EMAIL (a current user in the workspace) in .env");
  const st = (await call("sandbox_status_sandbox_status_get")) as Any;
  if (st.sandbox !== true) throw new Error("Refusing to seed: this key is not a sandbox workspace.");
  console.log(`Sandbox org ${st.org_id}. Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const list = await doCall("list: Q4 target accounts", "create_list_lists_post", { body: { title: "Q4 target accounts", type: "contacts" } });
  const listId = Number(((list.data as Any)?.id) ?? 0);

  // Prospects: 6 owned, 2 without an owner (T4). Same company for the deal.
  const people = [
    ["Dana", "Okafor", "VP Operations"], ["Priya", "Natarajan", "Head of RevOps"], ["Tom", "Lindqvist", "CTO"],
    ["Mei", "Tanaka", "Sales Ops Manager"], ["Omar", "Haddad", "Head of Growth"], ["Lucas", "Moreau", "COO"],
    ["Aisha", "Khan", "Director of Sales"], ["Daniel", "Reyes", "RevOps Analyst"],
  ];
  const ids: number[] = [];
  for (const [first, last, title] of people) {
    const r = await doCall(`prospect ${first} ${last}`, "create_contacts_contacts_post", {
      body: { first_name: first, last_name: last, job_title: title, work_email: `${first.toLowerCase()}@${PROSPECTS}`, company_domain: PROSPECTS, list_id: listId || null },
    });
    ids.push(Number(((r.data as Any)?.contact_id) ?? 0));
  }

  const seqs = [
    { name: "Q4 Outbound", user_email: owner, steps: [
      step(1, "Quick question, {{first_name}}", `Hi {{first_name}},\n\nNoticed {{company}} is scaling outbound. We help RevOps teams cut ramp time by 30%.\n\nWorth a 15-minute chat?${UNSUB}`),
      step(2, "Re: Quick question", `Hi {{first_name|there}}, quick follow-up on last week. If you sign this month we guarantee 50% off your first year. Worth a 15-minute call?${UNSUB}`, 2 * 86400),
    ] },
    { name: "Inbound welcome", user_email: owner, steps: [step(1, "Welcome aboard", `Hi {{first_name|there}},\n\nThanks for signing up. Here is how teams get started in their first week.${UNSUB}`)] },
    { name: "Re-engage lost", user_email: process.env.REENGAGE_OWNER_EMAIL || owner, steps: [step(1, "Still on your radar?", `Hi {{first_name|there}},\n\nAnything changed at {{company|your team}} since we last spoke?${UNSUB}`)] },
  ];
  for (const s of seqs) await doCall(`sequence ${s.name}`, "create_sequence_sequences_post", { body: { ...s, associated_list_id: listId || null, finish_on_reply: true } });

  // Open deal $15,000 with a SENT quote of $12,000 (T13).
  const deal = await doCall("deal Northwind platform ($15,000)", "create_deal_deals_post", {
    body: { name: "Northwind — Platform", owner_id: owner, contact_ids: ids.slice(0, 2).filter(Boolean).length ? ids.slice(0, 2) : [0], amount: 15000, currency: "USD", allow_duplicate: true },
  });
  const dealId = String(((deal.data as Any)?.id) ?? "");
  const quote = await doCall("quote ($12,000: 2 × $6,000)", "create_quote_quotes_post", {
    body: {
      title: "Northwind platform — annual", deal_id: dealId || null, currency: "USD", signer_contact_id: ids[0] || null,
      valid_until: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
      line_items: [{ product_name: "Platform seat bundle", unit_amount: 600000, quantity: 2 }],
    },
  });
  const quoteId = String(((quote.data as Any)?.id) ?? "");
  await doCall("send the quote (sandbox outbox)", "send_quote_quotes__quote_id__send_post", { path: { quote_id: quoteId }, body: { subject: "Your Northwind quote" } });

  console.log(apply
    ? `\nDone. In graph8: set the 3 sequences live, clear the owner on ${people[6][0]} and ${people[7][0]} (T4), then run \`npm run gates\` and take a snapshot.`
    : "\nDry run only. Re-run with --apply to create this in the sandbox.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
