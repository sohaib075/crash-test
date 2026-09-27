// Real graph8 backend over @graph8/sdk g8.api (docs/endpoints.md, endpoints-v4.md).
// Untyped payloads (outbox, org users, quote detail, event types) are normalized
// defensively in normalize.ts; `npm run gates` prints raw samples.
import type { Backend } from "../backend";
import { assertTestEmail, config, isTestEmail } from "../config";
import type { BookingLink, Deal, Mailbox, OwnerRow, Quote, SeqStep, Sequence, Workspace } from "../types";
import { allPages, type Any, call, data, items, num, str } from "./client";
import { normDeal, normOutbox, normQuote, normUser } from "./normalize";

export const TAG_FIELD = "crash_test_run";

async function steps(id: string): Promise<SeqStep[]> {
  const d = data<Any>(await call("list_sequence_steps_sequences__sequence_id__steps_get", { path: { sequence_id: id } }));
  return ((d.steps as Any[]) ?? [])
    .map((st) => {
      const sd = (st.step_data as Any) ?? {};
      const rendered = (st.rendered as Any) ?? {};
      return {
        id: str(st.id),
        order: Number(st.step_order ?? 0),
        type: str(st.step_type).toLowerCase(),
        delayMinutes: Math.round(Number(st.time_interval ?? 0) / 60),
        subject: str(sd.subject, rendered.subject) || undefined,
        body: str(sd.body, sd.message_body, rendered.body) || undefined,
      };
    })
    .sort((a, b) => a.order - b.order);
}

async function quotesWithDetail(): Promise<Quote[]> {
  const rows: Any[] = [];
  for (const status of ["sent", "viewed"]) {
    const r = data<Any>(await call("list_quotes_quotes_get", { query: { status, limit: 100 } }).catch(() => ({ data: { items: [] } })));
    rows.push(...((r.items as Any[]) ?? []));
  }
  return Promise.all(
    rows.slice(0, 40).map(async (q) => {
      const detail = await call("get_quote_quotes__quote_id__get", { path: { quote_id: str(q.id) } }).then(data<Any>).catch(() => ({}) as Any);
      return normQuote({ ...q, ...detail });
    }),
  );
}

async function bookingLinks(): Promise<BookingLink[]> {
  const r = (await call("list_event_types_event_types_get").catch(() => ({ data: [] }))) as Any;
  const list = ((r.data as Any[]) ?? []).slice(0, 20);
  return Promise.all(
    list.map(async (e) => {
      const d = (await call("get_event_type_appointments_event_types__event_type_id__get", { path: { event_type_id: Number(e.id) } }).catch(() => ({}))) as Any;
      const hosts = ((d.hosts ?? (d.data as Any)?.hosts ?? d.users ?? []) as Any[]).map((h) => ({ id: str(h.user_id, h.id), email: str(h.email).toLowerCase() }));
      return { id: str(e.id), name: str(e.title, e.slug), slug: str(e.slug), hostUserIds: hosts.map((h) => h.id), hostEmails: hosts.map((h) => h.email).filter(Boolean), raw: e };
    }),
  );
}

export const graph8Backend: Backend = {
  kind: "graph8",

  async sandboxStatus() {
    // /me works for every key: org, live/test mode and scopes.
    const me = data<Any>(await call("describe_current_key_me_get", undefined, { retries: 1 }).catch(() => ({}) as Any));
    const scopes = (me.scopes as string[] | undefined) ?? [];
    const writable = me.unrestricted === true || scopes.some((s) => !s.endsWith(":read"));
    try {
      const r = (await call("sandbox_status_sandbox_status_get", undefined, { retries: 1 })) as Any;
      return { sandbox: r.sandbox === true, workspaceId: str(r.org_id, me.org_id), name: str(me.org_name, r.org_name, "graph8 sandbox"), keyMode: str(me.key_mode), writable, detail: r };
    } catch (err) {
      // Live keys get a 404 here ("available only in the graph8 developer sandbox").
      if ((err as { status?: number }).status !== 404) throw err;
      return { sandbox: false, workspaceId: str(me.org_id), name: str(me.org_name, "graph8 workspace"), keyMode: str(me.key_mode, "live"), writable, detail: me };
    }
  },

  sequenceSteps: steps,

  async discover(): Promise<Workspace> {
    const [status, seqRows, listRows, usersRes, mbRes, supRes, dealRows, quotes, links] = await Promise.all([
      this.sandboxStatus(),
      allPages("list_sequences_sequences_get"),
      allPages("list_lists_lists_get", {}, 2),
      call("list_org_users_roles_org_users_get"),
      call("list_my_mailboxes_mailboxes_my_get"),
      call("list_suppressions_contacts_suppressions_get", { query: { limit: 200 } }).catch(() => ({ data: [] })),
      allPages("list_deals_deals_get", { outcome: "open" }, 3).catch(() => [] as Any[]),
      quotesWithDetail().catch(() => [] as Quote[]),
      bookingLinks().catch(() => [] as BookingLink[]),
    ]);

    const users = items(usersRes).map(normUser).filter((u) => u.id || u.email);
    const mailboxes: Mailbox[] = (((data<Any>(mbRes)?.mailboxes as Any[]) ?? [])).map((m) => ({
      id: str(m.id), email: str(m.email).toLowerCase(), ownerUserId: str(m.user_id, m.owner_id) || undefined,
    }));

    const sorted = [...seqRows].sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)));
    const sequences: Sequence[] = await Promise.all(
      sorted.map(async (s, idx): Promise<Sequence> => {
        const id = str(s.id);
        const [detail, st] = await Promise.all([
          call("get_sequence_sequences__sequence_id__get", { path: { sequence_id: id } }).then(data<Any>).catch(() => ({}) as Any),
          steps(id).catch(() => [] as SeqStep[]),
        ]);
        const pinned = str(detail.pinned_mailbox_id);
        const owner = str(detail.user_email, s.user_email).toLowerCase();
        const listId = detail.associated_list_id ?? s.associated_list_id;
        return {
          id,
          name: str(s.name, detail.name, id),
          status: str(detail.status, s.status, "unknown").toLowerCase(),
          steps: st,
          mailboxIds: pinned ? [pinned] : [],
          senderEmails: [pinned && mailboxes.find((m) => m.id === pinned)?.email, owner].filter(Boolean) as string[],
          ownerEmail: owner,
          sourceListIds: listId != null && detail.wait_for_new_contacts ? [String(listId)] : [],
          associatedListId: listId != null ? String(listId) : null,
          priority: idx + 1,
          contactCount: typeof s.contact_count === "number" ? s.contact_count : null,
          raw: { ...s, ...detail },
        };
      }),
    );

    return {
      graph8Id: status.workspaceId ?? "",
      name: status.name ?? "graph8 workspace",
      sandbox: status.sandbox,
      keyMode: status.keyMode,
      writable: status.writable,
      fetchedAt: new Date().toISOString(),
      sequences,
      lists: listRows.map((l) => ({ id: str(l.id), name: str(l.title), size: Number(l.total ?? 0) })),
      users,
      mailboxes,
      deals: dealRows.map(normDeal),
      quotes,
      bookingLinks: links,
      suppressionCount: items(supRes).length,
    };
  },

  async findContactByEmail(email) {
    const r = await call("list_contacts_contacts_get", { query: { email, limit: 5 } });
    const hit = items(r).find((c) => str(c.work_email).toLowerCase() === email.toLowerCase());
    return hit?.id != null ? String(hit.id) : null;
  },

  async createContact(c, customFields) {
    assertTestEmail(c.email);
    const r = data<Any>(await call("create_contacts_contacts_post", {
      body: {
        work_email: c.email,
        first_name: c.firstName || null,
        last_name: c.lastName || null,
        job_title: c.title || null,
        ...(c.company ? { company_domain: `${c.company.toLowerCase().replace(/[^a-z0-9]+/g, "")}.${config.testDomain}` } : {}),
        ...(customFields ? { custom_fields: customFields, create_missing_fields: true } : {}),
      },
    }));
    if (r.contact_id == null) throw new Error(`create contact failed: ${JSON.stringify(r.validation_errors ?? r).slice(0, 300)}`);
    return String(r.contact_id);
  },

  async deleteContact(id) {
    await call("delete_contact_contacts__contact_id__delete", { path: { contact_id: num(id) } });
  },

  async contactsByCustomField(field, value) {
    // No server-side filter exists; fetch test-domain contacts and filter client-side.
    const rows = await allPages("list_contacts_contacts_get", { include_custom_fields: true }, 10);
    return rows
      .filter((c) => isTestEmail(str(c.work_email)))
      .filter((c) => {
        const cf = (c.custom_fields as Record<string, string | null>) ?? {};
        const v = cf[field] ?? Object.entries(cf).find(([k]) => k.startsWith(field))?.[1];
        return value ? v === value : !!v;
      })
      .map((c) => ({ contactId: String(c.id), email: str(c.work_email) }));
  },

  async createList(name) {
    const r = data<Any>(await call("create_list_lists_post", { body: { title: name, type: "contacts", description: "Crash Test fake buyers; safe to delete" } }));
    return String(r.id);
  },

  async deleteList(id) {
    await call("delete_list_lists__list_id__delete", { path: { list_id: num(id) } });
  },

  async addToList(listId, ids) {
    const body = { contact_ids: ids.map(num) };
    try {
      await call("add_contacts_to_list_lists__list_id__contacts_post", { path: { list_id: num(listId) }, body });
    } catch (err) {
      if ((err as { status?: number }).status !== 409) throw err;
      await call("add_contacts_to_list_lists__list_id__contacts_post", { path: { list_id: num(listId) }, body: { ...body, conflict_resolution: "add_all" } });
    }
  },

  async enrol(seqId, ids, listId) {
    await call("add_contacts_to_sequence_sequences__sequence_id__contacts_post", {
      path: { sequence_id: seqId },
      body: { contact_ids: ids.map(num), list_id: num(listId) },
    }, { retries: 1 });
  },

  async withdraw(ids, seqIds) {
    const contact_ids = ids.map(num);
    if (!seqIds?.length) {
      await call("withdraw_contacts_from_sequences_contacts_withdraw_from_sequences_post", { body: { contact_ids, remove_all: true, target_state: "removed", source: "crash-test" } });
      return;
    }
    for (const sequence_id of seqIds) {
      await call("withdraw_contacts_from_sequences_contacts_withdraw_from_sequences_post", { body: { contact_ids, sequence_id, target_state: "removed", source: "crash-test" } });
    }
  },

  async contactSequenceIds(id) {
    const r = await call("get_contact_sequences_contacts__contact_id__sequences_get", { path: { contact_id: num(id) } });
    return items(r)
      .filter((x) => !/removed|withdrawn|completed|finished/i.test(str(x.state, x.status)))
      .map((x) => str(x.sequence_id, (x.sequence as Any)?.id, x.id))
      .filter(Boolean);
  },

  async sequenceContactIds(seqId) {
    const rows = await allPages("list_sequence_contacts_sequences__sequence_id__contacts_get", {}, 5, { sequence_id: seqId });
    return rows.filter((r) => r.contact_id != null && !/removed|completed|finished/i.test(str(r.state))).map((r) => String(r.contact_id));
  },

  async suppress(id) {
    await call("bulk_add_suppressions_contacts_suppressions_bulk_add_post", { body: { contact_ids: [num(id)], channel: "all", reason: "crash-test opt-out scenario" } });
  },
  async reinstate(id) {
    await call("reinstate_suppressions_contacts_suppressions_reinstate_post", { body: { contact_ids: [num(id)], reason: "crash-test clean-up" } });
  },
  async isSuppressed(id) {
    const d = data<Any>(await call("check_contact_suppression_contacts__contact_id__suppression_get", { path: { contact_id: num(id) } }));
    return d.is_suppressed === true;
  },

  async outbox(since) {
    const t = Date.parse(since);
    const out = [];
    for (let offset = 0; offset < 1000; offset += 200) {
      const r = (await call("sandbox_outbox_sandbox_outbox_get", { query: { limit: 200, offset } })) as Any;
      const batch = ((r.items as Any[]) ?? []).map(normOutbox);
      out.push(...batch.filter((e) => !e.sentAt || Date.parse(e.sentAt) >= t));
      if (batch.length < 200) break;
      if (batch.every((e) => e.sentAt && Date.parse(e.sentAt) < t)) break;
    }
    return out;
  },

  async activeContactOwners(): Promise<OwnerRow[]> {
    const seqs = await allPages("list_sequences_sequences_get");
    const live = seqs.filter((s) => /live|active|running|resum|scheduling|waiting/i.test(str(s.status)));
    const inSeq = new Set<string>();
    for (const s of live) (await this.sequenceContactIds(str(s.id)).catch(() => [] as string[])).forEach((id) => inSeq.add(id));
    const contacts = await allPages("list_contacts_contacts_get", {}, 10);
    return contacts
      .filter((c) => c.id != null && inSeq.has(String(c.id)))
      .map((c) => ({
        contactId: String(c.id),
        email: str(c.work_email).toLowerCase(),
        ownerId: (c.owner_id as string | null) ?? null,
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
      }))
      .filter((c) => !isTestEmail(c.email));
  },

  async sequenceStatus(id) {
    const d = data<Any>(await call("get_sequence_sequences__sequence_id__get", { path: { sequence_id: id } }));
    return str(d.status, "unknown").toLowerCase();
  },
  async pauseSequence(id) {
    await call("pause_sequence_sequences__sequence_id__pause_post", { path: { sequence_id: id } }, { retries: 1 });
  },
  async resumeSequence(id) {
    await call("resume_sequence_sequences__sequence_id__resume_post", { path: { sequence_id: id } }, { retries: 1 });
  },

  async previewReown(ids, ownerUserId) {
    const listId = await this.createList(`crash-test reown preview ${Date.now()}`);
    try {
      await this.addToList(listId, ids);
      const p = data<Any>(await call("preview_list_owner_transfer_lists__audience_id__owner_preview_get", {
        path: { audience_id: num(listId) }, query: { new_owner_user_id: ownerUserId },
      }));
      return { count: Number(p.records_affected ?? p.count ?? p.total ?? ids.length) };
    } finally {
      await this.deleteList(listId).catch(() => {});
    }
  },

  async reownViaList(ids, ownerUserId) {
    const users = items(await call("list_org_users_roles_org_users_get")).map(normUser);
    const owner = users.find((u) => u.id === ownerUserId || u.aliases?.includes(ownerUserId) || u.email === ownerUserId);
    if (!owner?.email) throw new Error(`owner ${ownerUserId} not found in org users`);
    const listId = await this.createList(`crash-test reown ${Date.now()}`);
    try {
      await this.addToList(listId, ids);
      await call("reassign_list_owner_lists__audience_id__owner_patch", {
        path: { audience_id: num(listId) },
        body: { owner_user_id: owner.id, owner_email: owner.email, mode: "list_and_records" },
      });
    } finally {
      await this.deleteList(listId).catch(() => {});
    }
  },

  async clearOwnerViaList(ids) {
    const listId = await this.createList(`crash-test restore ${Date.now()}`);
    try {
      await this.addToList(listId, ids);
      await call("assign_contact_owner_contacts_assign_owner_post", { body: { owner_id: null, list_id: num(listId) } });
    } finally {
      await this.deleteList(listId).catch(() => {});
    }
  },

  async createTask({ contactId, dealId, title, body }) {
    const req = {
      title, description: body, priority: 1, tags: ["crash-test"],
      ...(dealId ? { entity_type: "deal", entity_id: dealId } : {}),
    };
    const r = contactId
      ? await call("create_task_contacts__contact_id__tasks_post", { path: { contact_id: num(contactId) }, body: req })
      : await call("create_global_task_tasks_post", { body: req });
    return str(data<Any>(r).id);
  },
  async deleteTask(id) {
    await call("delete_task_tasks__task_id__delete", { path: { task_id: id } });
  },
  async addDealNote(dealId, body) {
    const r = data<Any>(await call("create_deal_note_deals__deal_id__notes_post", { path: { deal_id: dealId }, body: { content: body } }));
    return str(r.id);
  },
  async deleteDealNote(dealId, noteId) {
    await call("delete_deal_note_deals__deal_id__notes__note_id__delete", { path: { deal_id: dealId, note_id: noteId } });
  },
  async dealsForContacts(ids): Promise<Deal[]> {
    const set = new Set(ids);
    const deals = (await allPages("list_deals_deals_get", { outcome: "open" }, 3)).map(normDeal);
    return deals.filter((d) => d.contactIds.some((c) => set.has(c)));
  },
};
