// In-memory workspace for the AUTOMATED TEST SUITE ONLY (never used by the app).
// Mirrors the planted demo problems from build plan v4 §28:
//   T1 Q4 Outbound ignores suppressions · T2 Q4 + Re-engage have no cap
//   T3 Q4 step 1 "Hi {{first_name}}," without fallback · T4 3 orphaned leads
//   T7 Q4 step 2 promises "guarantee 50% off" · T13 quote Q-1042 $12,000 vs deal $15,000
import type { Backend } from "./backend";
import { isTestEmail } from "./config";
import type { Deal, NewContact, Quote, SentEmail, Workspace } from "./types";

type MSeq = {
  id: string; name: string; status: string; mailboxId: string; priority: number;
  honorsSuppression: boolean; honorsGlobalCap: boolean; sourceListId?: string; delayMs: number;
  steps: { id: string; subject: string; body: string; delayMinutes: number }[];
};
type MContact = NewContact & { id: string; ownerId: string | null; suppressed: boolean; sequences: Set<string>; custom: Record<string, string> };

type State = {
  seqs: MSeq[];
  contacts: Map<string, MContact>;
  lists: Map<string, { id: string; name: string; contacts: Set<string> }>;
  outbox: SentEmail[];
  tasks: Map<string, { id: string; contactId?: string; dealId?: string; title: string; body: string }>;
  notes: Map<string, { id: string; dealId: string; body: string }>;
  deals: Deal[];
  quotes: Quote[];
  users: { id: string; email: string; name: string; active: boolean }[];
  mailboxes: { id: string; email: string; ownerUserId: string }[];
  nextId: number;
  timers: Set<ReturnType<typeof setTimeout>>;
};

const g = globalThis as unknown as { __crashMock?: State };

function seed(): State {
  const s: State = {
    seqs: [
      {
        id: "seq_q4", name: "Q4 Outbound", status: "live", mailboxId: "mb_sara", priority: 1, delayMs: 300,
        honorsSuppression: false, honorsGlobalCap: false,
        steps: [
          { id: "q4_1", subject: "Quick question, {{first_name}}", body: "Hi {{first_name}},\n\nNoticed {{company}} is scaling outbound. We help RevOps teams cut ramp time by 30%.\n\nWorth a 15-minute chat?\n\nSara\n\nUnsubscribe: {{unsubscribe_link}}", delayMinutes: 0 },
          { id: "q4_2", subject: "Re: Quick question", body: "Hi {{first_name|there}}, quick follow-up on last week. If you sign this month we guarantee 50% off your first year. Worth a 15-minute call?\n\nUnsubscribe: {{unsubscribe_link}}", delayMinutes: 2880 },
        ],
      },
      {
        id: "seq_in", name: "Inbound welcome", status: "live", mailboxId: "mb_omar", priority: 2, delayMs: 500,
        honorsSuppression: true, honorsGlobalCap: true, sourceListId: "list_inbound",
        steps: [{ id: "in_1", subject: "Welcome aboard", body: "Hi {{first_name|there}},\n\nThanks for signing up. Here's how teams get started.\n\nOmar\n\nUnsubscribe: {{unsubscribe_link}}", delayMinutes: 0 }],
      },
      {
        id: "seq_re", name: "Re-engage lost", status: "live", mailboxId: "mb_jake", priority: 3, delayMs: 700,
        honorsSuppression: true, honorsGlobalCap: false,
        steps: [{ id: "re_1", subject: "Still on your radar?", body: "Hi {{first_name|there}},\n\nAnything changed at {{company|your team}}?\n\nJake\n\nUnsubscribe: {{unsubscribe_link}}", delayMinutes: 0 }],
      },
    ],
    contacts: new Map(),
    lists: new Map([["list_inbound", { id: "list_inbound", name: "Inbound signups", contacts: new Set<string>() }]]),
    outbox: [],
    tasks: new Map(),
    notes: new Map(),
    deals: [],
    quotes: [],
    users: [
      { id: "u_sara", email: "sara@demo-co.test", name: "Sara Malik", active: true },
      { id: "u_omar", email: "omar@demo-co.test", name: "Omar Siddiqui", active: true },
      { id: "u_lena", email: "lena@demo-co.test", name: "Lena Brandt", active: true },
    ],
    mailboxes: [
      { id: "mb_sara", email: "sara@demo-co.test", ownerUserId: "u_sara" },
      { id: "mb_omar", email: "omar@demo-co.test", ownerUserId: "u_omar" },
      { id: "mb_jake", email: "jake@demo-co.test", ownerUserId: "u_jake" },
    ],
    nextId: 1000,
    timers: new Set(),
  };
  const owners = ["u_sara", "u_omar", "u_lena"];
  for (let i = 0; i < 18; i++) {
    const id = `c_${100 + i}`;
    const ownerId = i === 3 || i === 11 ? null : i === 16 ? "u_jake" : owners[i % owners.length];
    s.contacts.set(id, {
      id, email: `lead${i}@prospect${i % 6}.test`, firstName: `Lead${i}`, lastName: "P", company: `Prospect ${i % 6}`, title: "Director",
      ownerId, suppressed: false, sequences: new Set([i % 3 === 0 ? "seq_re" : "seq_q4"]), custom: {},
    });
  }
  s.deals = [
    { id: "d_1", name: "Prospect 0 — Platform", amount: 15000, currency: "USD", stage: "proposal", open: true, ownerId: "u_sara", contactIds: ["c_100", "c_101"] },
    { id: "d_2", name: "Prospect 1 — Expansion", amount: 33000, currency: "USD", stage: "negotiation", open: true, ownerId: "u_omar", contactIds: ["c_102", "c_104"] },
    { id: "d_3", name: "Prospect 2 — Pilot", amount: 8000, currency: "USD", stage: "qualified", open: true, ownerId: "u_lena", contactIds: ["c_103"] },
  ];
  s.quotes = [
    { id: "q_1042", number: "Q-1042", status: "sent", total: 12000, currency: "USD", lineItemCount: 2, expiresAt: new Date(Date.now() + 14 * 864e5).toISOString(), sentAt: new Date().toISOString(), dealId: "d_1", senderEmail: "sara@demo-co.test", senderUserId: "u_sara", recipientContactId: "c_100", recipientEmail: "lead0@prospect0.test", raw: {} },
    { id: "q_1043", number: "Q-1043", status: "sent", total: 33000, currency: "USD", lineItemCount: 3, expiresAt: new Date(Date.now() + 20 * 864e5).toISOString(), sentAt: new Date().toISOString(), dealId: "d_2", senderEmail: "omar@demo-co.test", senderUserId: "u_omar", recipientContactId: "c_102", recipientEmail: "lead2@prospect2.test", raw: {} },
  ];
  return s;
}

function st(): State {
  return (g.__crashMock ??= seed());
}

export function resetMock() {
  for (const t of g.__crashMock?.timers ?? []) clearTimeout(t);
  g.__crashMock = seed();
}
export function mockState() {
  return st();
}

function render(tpl: string, c: MContact) {
  return tpl.replace(/\{\{\s*(\w+)(?:\|([^}]*))?\s*\}\}/g, (_m, key: string, fallback?: string) => {
    const v = key === "first_name" ? c.firstName : key === "company" ? c.company : key === "unsubscribe_link" ? "https://u.test/x" : "";
    if (v) return v;
    if (fallback !== undefined) return fallback;
    return key === "company" ? "{{company}}" : "";
  });
}

function scheduleFirstStep(s: State, q: MSeq, c: MContact) {
  const t = setTimeout(() => {
    s.timers.delete(t);
    if (!/live|active/.test(q.status) || !c.sequences.has(q.id) || !s.contacts.has(c.id)) return;
    if (c.suppressed && q.honorsSuppression) return;
    if (q.honorsGlobalCap && s.outbox.some((e) => e.to === c.email && Date.parse(e.sentAt) > Date.now() - 864e5)) return;
    const step = q.steps[0];
    const mb = s.mailboxes.find((m) => m.id === q.mailboxId)!;
    s.outbox.push({ outboxId: `ob_${s.nextId++}`, to: c.email, from: mb.email, subject: render(step.subject, c), sentAt: new Date().toISOString(), body: render(step.body, c), raw: {} });
  }, q.delayMs);
  s.timers.add(t);
}

export const mockBackend: Backend = {
  kind: "mock",
  async sandboxStatus() {
    return { sandbox: true, workspaceId: "mock-demo", name: "Demo workspace" };
  },
  async discover(): Promise<Workspace> {
    const s = st();
    return {
      graph8Id: "mock-demo", name: "Demo workspace", sandbox: true, fetchedAt: new Date().toISOString(),
      sequences: s.seqs.map((q) => ({
        id: q.id, name: q.name, status: q.status, priority: q.priority, raw: {},
        steps: q.steps.map((x, i) => ({ id: x.id, order: i + 1, type: "email", delayMinutes: x.delayMinutes, subject: x.subject, body: x.body })),
        mailboxIds: [q.mailboxId], senderEmails: [s.mailboxes.find((m) => m.id === q.mailboxId)!.email],
        ownerEmail: s.mailboxes.find((m) => m.id === q.mailboxId)!.email,
        sourceListIds: q.sourceListId ? [q.sourceListId] : [], associatedListId: q.sourceListId ?? null,
        contactCount: [...s.contacts.values()].filter((c) => c.sequences.has(q.id) && !isTestEmail(c.email)).length,
      })),
      lists: [...s.lists.values()].map((l) => ({ id: l.id, name: l.name, size: l.contacts.size })),
      users: s.users, mailboxes: s.mailboxes, deals: s.deals, quotes: s.quotes,
      bookingLinks: [{ id: "bl_1", name: "Demo call", slug: "demo-call", hostUserIds: ["u_sara"], hostEmails: ["sara@demo-co.test"], raw: {} }],
      suppressionCount: [...s.contacts.values()].filter((c) => c.suppressed).length,
    };
  },
  async sequenceSteps(id) {
    const q = st().seqs.find((x) => x.id === id);
    return (q?.steps ?? []).map((x, i) => ({ id: x.id, order: i + 1, type: "email", delayMinutes: x.delayMinutes, subject: x.subject, body: x.body }));
  },
  async findContactByEmail(email) {
    for (const c of st().contacts.values()) if (c.email === email) return c.id;
    return null;
  },
  async createContact(c, custom = {}) {
    const s = st();
    const id = `c_${s.nextId++}`;
    s.contacts.set(id, { ...c, id, ownerId: "u_lena", suppressed: false, sequences: new Set(), custom });
    return id;
  },
  async deleteContact(id) { st().contacts.delete(id); },
  async contactsByCustomField(field, value) {
    return [...st().contacts.values()].filter((c) => (value ? c.custom[field] === value : !!c.custom[field])).map((c) => ({ contactId: c.id, email: c.email }));
  },
  async createList(name) {
    const s = st();
    const id = `list_${s.nextId++}`;
    s.lists.set(id, { id, name, contacts: new Set() });
    return id;
  },
  async deleteList(id) { st().lists.delete(id); },
  async addToList(listId, ids) {
    const l = st().lists.get(listId);
    if (!l) throw new Error(`no list ${listId}`);
    ids.forEach((id) => l.contacts.add(id));
  },
  async enrol(seqId, ids) {
    const s = st();
    const q = s.seqs.find((x) => x.id === seqId);
    if (!q) throw new Error(`no sequence ${seqId}`);
    for (const id of ids) {
      const c = s.contacts.get(id);
      if (!c) continue;
      c.sequences.add(seqId);
      scheduleFirstStep(s, q, c);
    }
  },
  async withdraw(ids, seqIds) {
    for (const id of ids) {
      const c = st().contacts.get(id);
      if (!c) continue;
      if (seqIds?.length) seqIds.forEach((q) => c.sequences.delete(q));
      else c.sequences.clear();
    }
  },
  async contactSequenceIds(id) { return [...(st().contacts.get(id)?.sequences ?? [])]; },
  async sequenceContactIds(seqId) { return [...st().contacts.values()].filter((c) => c.sequences.has(seqId)).map((c) => c.id); },
  async suppress(id) { const c = st().contacts.get(id); if (c) c.suppressed = true; },
  async reinstate(id) { const c = st().contacts.get(id); if (c) c.suppressed = false; },
  async isSuppressed(id) { return !!st().contacts.get(id)?.suppressed; },
  async outbox(since) { const t = Date.parse(since); return st().outbox.filter((e) => Date.parse(e.sentAt) >= t); },
  async activeContactOwners() {
    return [...st().contacts.values()].filter((c) => c.sequences.size > 0 && !isTestEmail(c.email))
      .map((c) => ({ contactId: c.id, email: c.email, ownerId: c.ownerId, name: `${c.firstName} ${c.lastName}` }));
  },
  async sequenceStatus(id) { return st().seqs.find((q) => q.id === id)?.status ?? "unknown"; },
  async pauseSequence(id) { const q = st().seqs.find((x) => x.id === id); if (q) q.status = "paused"; },
  async resumeSequence(id) { const q = st().seqs.find((x) => x.id === id); if (q) q.status = "live"; },
  async previewReown(ids) { return { count: ids.length }; },
  async reownViaList(ids, ownerId) { for (const id of ids) { const c = st().contacts.get(id); if (c) c.ownerId = ownerId; } },
  async clearOwnerViaList(ids) { for (const id of ids) { const c = st().contacts.get(id); if (c) c.ownerId = null; } },
  async createTask(t) { const s = st(); const id = `task_${s.nextId++}`; s.tasks.set(id, { id, ...t }); return id; },
  async deleteTask(id) { st().tasks.delete(id); },
  async addDealNote(dealId, body) { const s = st(); const id = `note_${s.nextId++}`; s.notes.set(id, { id, dealId, body }); return id; },
  async deleteDealNote(_d, id) { st().notes.delete(id); },
  async dealsForContacts(ids) { const set = new Set(ids); return st().deals.filter((d) => d.contactIds.some((c) => set.has(c))); },
};
