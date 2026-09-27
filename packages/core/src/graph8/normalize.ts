// Defensive normalizers for graph8 payloads the contract leaves untyped.
import type { Deal, OrgUser, Quote, SentEmail } from "../types";
import { type Any, money, str } from "./client";

export function normOutbox(i: Any): SentEmail {
  const to = i.to ?? i.recipient ?? i.to_email ?? i.recipient_email ?? (i.recipients as unknown[])?.[0];
  const from = i.from ?? i.sender ?? i.from_email ?? i.sender_email ?? i.mailbox_email;
  const payload = (i.payload as Any) ?? {};
  const body = str(i.body, i.text, i.body_text, i.html, i.body_html, i.content, i.message, payload.body, payload.html, payload.text);
  return {
    outboxId: str(i.id, i.outbox_id, i.message_id),
    to: str(typeof to === "object" && to ? (to as Any).email : to).toLowerCase(),
    from: str(typeof from === "object" && from ? (from as Any).email : from).toLowerCase(),
    subject: str(i.subject, payload.subject),
    sentAt: str(i.sent_at, i.created_at, i.timestamp, i.queued_at),
    body: body.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim(),
    raw: i,
  };
}

export function normUser(u: Any): OrgUser {
  const name = str(u.name, u.full_name, [u.first_name, u.last_name].filter(Boolean).join(" "));
  const inactive = u.is_active === false || u.active === false || /deactiv|disabl|removed|left|suspend/i.test(str(u.status));
  const aliases = [u.propel_auth_id, u.user_id, u.id, u.member_id].filter((x) => x != null && x !== "").map(String);
  return { id: str(u.propel_auth_id, u.user_id, u.id), email: str(u.email).toLowerCase(), name: name || str(u.email), active: !inactive, aliases };
}

export function normDeal(d: Any): Deal {
  const contacts = ((d.contacts as Any[]) ?? []).map((c) => str(c.id, c.person_id)).filter(Boolean);
  const primary = d.primary_contact as Any | undefined;
  if (primary?.id != null && !contacts.includes(String(primary.id))) contacts.push(String(primary.id));
  return {
    id: str(d.id, d.deal_id),
    name: str(d.name, "Deal"),
    amount: money(d.amount ?? d.value),
    currency: str(d.currency, "USD"),
    stage: str(d.stage_name, d.stage),
    open: !/won|lost|closed/i.test(str(d.status, d.outcome)),
    ownerId: str(d.owner_id) || null,
    contactIds: contacts,
  };
}

export function normQuote(q: Any): Quote {
  const lines = Array.isArray(q.line_items) ? (q.line_items as Any[]) : null;
  // Line items are in cents; compute a total if the quote doesn't carry one.
  const lineTotal = lines?.reduce((sum, li) => {
    const unit = Number(li.unit_amount ?? 0) / 100;
    const qty = Number(li.quantity ?? 1);
    const disc = Number(li.discount_pct ?? 0);
    return sum + unit * qty * (1 - disc / 100);
  }, 0);
  let total = money(q.total ?? q.total_amount ?? q.amount ?? q.grand_total);
  // Line items are cents; if the quote total is clearly the same number in cents, convert it.
  if (total != null && lineTotal && Math.abs(total / 100 - lineTotal) <= Math.max(1, lineTotal * 0.01)) total = total / 100;
  total ??= lineTotal ? Math.round(lineTotal * 100) / 100 : null;
  const owner = (q.owner as Any) ?? (q.sender as Any) ?? {};
  const signer = (q.signer as Any) ?? {};
  return {
    id: str(q.id),
    number: str(q.quote_number, q.number, q.title, q.id),
    status: str(q.status).toLowerCase(),
    total,
    currency: str(q.currency, "USD"),
    lineItemCount: lines ? lines.length : null,
    expiresAt: str(q.valid_until, q.expires_at, q.expiry_date) || null,
    sentAt: str(q.sent_at) || null,
    dealId: str(q.deal_id, (q.deal as Any)?.id) || null,
    senderEmail: str(q.owner_email, owner.email, q.sender_email, typeof q.owner_id === "string" && q.owner_id.includes("@") ? q.owner_id : "").toLowerCase() || null,
    senderUserId: str(owner.id, typeof q.owner_id === "string" && !q.owner_id.includes("@") ? q.owner_id : "") || null,
    recipientContactId: str(q.signer_contact_id, signer.id, q.billing_contact_id) || null,
    recipientEmail: str(q.signer_email, signer.email, q.billing_email).toLowerCase() || null,
    raw: q,
  };
}
