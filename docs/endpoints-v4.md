# graph8 SDK endpoint reference, part 4: deals, quotes, scheduling, fields, notes, webhooks, workflows, credits

Source: `@graph8/sdk` v0.245.0, `node_modules/@graph8/sdk/dist/index.d.ts` (`ApiOperationMap`) and `dist/index.js` (runtime). Tiers and scopes come from `docs/ops.json` and the JSDoc on each operation.
Everything below is copied from the generated types. Nothing was verified against the live API.

The conventions are the same as in `docs/endpoints.md`: see its section 0 for runtime behaviour, errors, retry and pagination.

- Every operation also accepts `headers?: { "X-Target-Org-Id"?: string | null }`. It is left out of each entry below.
- `?` means optional and `| null` means nullable.
- "Envelope" means the 200 type is `ApiResponse_X_ = { data: X; pagination?: PaginationMeta$1 | null }`.
- `PaginationMeta$1 = { page: number; limit: number; total: number; has_next: boolean; next_cursor?: string | null }`
- "Untyped" means the type is `Record<string, unknown>`, or the payload is `{ items?: Array<unknown>; [key: string]: unknown }`. Aliases for the second form include `CrmCollectionPayload`, `DealCollectionPayload` and `QuoteListPayload`.
- **Not enveloped:** when the output type is a bare `Record<string, unknown>`, as with most `appointments.*` and `workflows.*` operations, the SDK returns the raw JSON. The types do not promise a `data` key.
- **Runtime retry classes** (from `dist/index.js`):
  - Operations in `BILLABLE_ROUTES` or `EXTERNAL_ROUTES` are "no blind retry". They retry only on 429 and on connect-phase network errors, and never on 5xx.
  - Every `external`-tier operation below is in `EXTERNAL_ROUTES`. Examples are `POST /appointments/bookings`, `POST|PATCH /webhooks...`, `POST /workflows/{id}/execute`, `PATCH /quotes/{id}` and `PATCH /sequences/{id}/steps/{step_id}`.
  - `write`, `read` and `destructive` operations get the normal retry on 5xx.
- **Query encoding:** `buildQuery` calls `qs.set(k, String(v))`. An array value is therefore sent as a single comma-joined value (`name=a,b`), not as repeated keys. See `events.listOrgEvents`.

---

## 1. Deals (tag `deals`, plus `notes` for deal notes)

**Amount field name:** `amount: number | null` on `DealResponse`, `DealDetail`, `DealCreateRequest` and `DealUpdateRequest`, with `currency: string | null` beside it.

- The contact-side and company-side deal views (`ContactDealResponse`) call the same value **`value`**, and call the stage **`stage`** (a name, not an id).
- Deal line items are separate: `listDealLineItems` returns `amount`, `linked_quote_total` and `amount_mismatch`.

**IDs:**

- `deal_id` is a `string` (UUID).
- Contact ids on deals are mostly `number` (the "mashup_contact_id"). The exceptions are **`addDealContact` / `removeDealContact`, which take `person_id: string`**.

### Shared shapes

- `DealResponse`:
  `{ id?: string | null; name?: string | null; amount?: number | null; currency?: string | null; close_date?: string | null; closed_lost_reason?: string | null; company_id?: unknown | null; contact_count?: number; contacts?: Array<ContactBrief> | null; primary_contact?: ContactBrief | null; description?: string | null; last_activity_at?: string | null; owner_id?: string | null; owner_email?: string | null; owner_name?: string | null; pipeline_id?: string | null; stage_id?: string | null; stage_name?: string | null; revision?: number | null /* CRM revision after a conditional update */; created_at?: string | null; updated_at?: string | null }`
  - There is **no `status`, `outcome` or `is_won` field**. Filter with the `outcome` query on `listDeals`, or read `DealDetail.status`.
- `ContactBrief = { id: number; email?: string | null; name?: string | null; role?: string | null; title?: string | null }`
- `ContactDealResponse = { deal_id?: string | null; name?: string | null; value?: number | null; currency?: string | null; stage?: string | null; pipeline_id?: string | null; owner_id?: string | null; role?: string | null; close_date?: string | null; created_at?: string | null }`
- `NoteResponse = { id: string; content: string; entity_id: string; entity_type: string; created_at?: string | null; created_by?: string | null; created_by_name?: string | null; read_only?: boolean; updated_at?: string | null }`

### `g8.api.deals.listDeals` — `list_deals_deals_get` — GET /api/v1/deals (read, `deals:read`)

- query?:
  - `page?: number`, `limit?: number`
  - `stage_id?: string | null`, `pipeline_id?: string | null`
  - `search?: string | null` (deal name)
  - `owner_id?: string | null`, `owner_email?: string | null`
  - **`outcome?: ("won" | "lost" | "open") | null`**. A deal is exactly one of these. The JSDoc says to prefer this over `is_closed_won`.
  - `is_closed_won?: boolean | null`. LEGACY: `false` means "not won", so it returns open, lost *and* unclassified deals.
  - `last_activity_before?: string | null`
  - `stale_before?: string | null` (last touched before this time, or never touched)
  - `has_activity?: boolean | null`
  - `has_contact?: boolean | null` (`false` returns the orphaned deals)
  - `close_after?: string | null` (inclusive), `close_before?: string | null` (exclusive, half-open window)
- 200 envelope, `data: Array<DealResponse>`
- No `cursor` query param is declared.

### `g8.api.deals.getDeal` — `get_deal_deals__deal_id__get` — GET /api/v1/deals/{deal_id} (read, `deals:read`)

- path: `{ deal_id: string }` (UUID)
- 200 envelope, `data: DealResponse`

### `g8.api.deals.getDealDetail` — `get_deal_detail_deals__deal_id__detail_get` — GET /api/v1/deals/{deal_id}/detail (read, `deals:read`)

- path: `{ deal_id: string }`
- query?: `{ include_revision?: boolean }`
- 200 envelope, `data: DealDetail`:
  `{ id?; name?; amount?: number | null; currency?; close_date?; company_id?: string | null; owner_id?; pipeline_id?; stage?: string | null; stage_id?; status?: string | null; description?; revision?: number | null; created_at?; updated_at?; [key: string]: unknown }`
- A `revision` of `null` means the org has no revision tracking, so saves are unconditional. It does not mean revision 1.

### `g8.api.deals.updateDeal` — `update_deal_deals__deal_id__patch` — PATCH /api/v1/deals/{deal_id} (write, `deals:write`)

- path: `{ deal_id: string }`
- body (required) `DealUpdateRequest`, every field optional:
  - `name?: string | null`, `description?: string | null`
  - `amount?: number | null`, `currency?: string | null`
  - `close_date?: string | null` (ISO 8601)
  - `stage_id?: string | null`
  - `owner_id?: string | null`. This is a member id, email or PropelAuth uid. It **cannot be cleared**.
  - `add_contact_ids?: Array<number>` (mashup_contact_ids; they must match the deal's company; idempotent)
  - `remove_contact_ids?: Array<number>` (idempotent)
  - `contact_roles?: Record<string, string | null> | null`. This is keyed by the contact id as a string, for example `{"5500429":"champion"}`. Valid roles are champion, decision_maker, influencer, blocker, coach and end_user. `null` clears the role. Each contact must already be linked to the deal.
  - `expected_revision?: number | null`. The update applies only if the CRM revision still matches; otherwise the server returns 409.
- 200 envelope, `data: DealResponse`
- There is no `pipeline_id` in the body. Use `deals.moveDealToPipeline` (PUT /deals/{deal_id}/pipeline) to change the pipeline.

### `g8.api.deals.createDeal` — `create_deal_deals_post` — POST /api/v1/deals (write, `deals:write`)

- body (required) `DealCreateRequest`:
  - `name: string` (required)
  - **`owner_id: string`** (required; user id or email)
  - **`contact_ids: Array<number>`** (required, at least 1; all must share one company)
  - `amount?: number | null`, `currency?: string | null` (default USD), `close_date?: string | null`, `description?: string | null`
  - `pipeline_id?: string | null`, `stage_id?: string | null`
  - `allow_duplicate?: boolean` (default: the server refuses a second deal for the same company)
  - `company_id?: number | null` (deprecated; it is derived from the contacts)
- 200 envelope, `data: DealResponse`

### `g8.api.deals.listPipelines` — `list_pipelines_deals_pipelines_get` — GET /api/v1/deals/pipelines (read)

- 200 envelope, `data: Array<PipelineResponse>`:
  - `PipelineResponse = { id: string; name: string; is_default?: boolean; stages?: Array<PipelineStageResponse> }`
  - `PipelineStageResponse = { id: string; name: string; position?: number | null; probability?: number | null; stage_type?: string | null; color?: string | null; channel_scripts?: Record<string, string>; required_elements?: string[]; recommended_elements?: string[] }`

### Deal notes

#### `g8.api.notes.createDealNote` — `create_deal_note_deals__deal_id__notes_post` — POST /api/v1/deals/{deal_id}/notes (write, `notes:write`)

- path: `{ deal_id: string }`
- body (required) `NoteCreateRequest = { content: string }` (plain text or markdown)
- 200 envelope, `data: NoteResponse`

#### `g8.api.notes.listDealNotes` — `list_deal_notes_deals__deal_id__notes_get` — GET /api/v1/deals/{deal_id}/notes (read, `notes:read`)

- path: `{ deal_id: string }`. There is no query.
- 200 envelope, `data: Array<NoteResponse>`

#### `g8.api.deals.updateDealNote` — `update_deal_note_deals__deal_id__notes__note_id__put` — PUT /api/v1/deals/{deal_id}/notes/{note_id} (write, **`deals:write`**)

- path: `{ deal_id: string; note_id: string }`
- body `DealNoteUpdateRequest`:
  - `content: string`. This is a full replacement.
  - `mentioned_users?: Array<{ id: string; name?: string | null; email?: string | null }>`. The list replaces the existing mentions.
- 200 envelope, `data: DealOpResponse` (untyped)

#### `g8.api.deals.deleteDealNote` — `delete_deal_note_deals__deal_id__notes__note_id__delete` — DELETE /api/v1/deals/{deal_id}/notes/{note_id} (destructive, **`deals:delete`**)

- path: `{ deal_id: string; note_id: string }`
- 200 envelope, `data: DealOpResponse` (untyped)

Scope asymmetry: creating and listing deal notes needs `notes:*`, but editing and deleting them needs `deals:*`. `notes.deleteNote` (DELETE /notes/{note_id}, `notes:delete`) is the generic alternative (see section 5).

### Deal ↔ contact membership

#### `g8.api.deals.listDealContacts` — `list_deal_contacts_deals__deal_id__contacts_get` — GET /api/v1/deals/{deal_id}/contacts (read, `deals:read`)

- path: `{ deal_id: string }`
- 200 envelope, `data: DealContactListResponse = { contacts?: Array<DealContact>; total?: number; [key: string]: unknown }`
- `DealContact`:
  `{ id?: string | null /* LINK id, not the person id */; person_id?: string | null; name?; email?; title?; role?: string | null /* role on THIS deal */; buying_role?: string | null /* role from the contact record */; is_primary?: boolean | null; created_at?; [key: string]: unknown }`
- `person_id` is typed as a string. Compare it with numeric contact ids using `String(id)`.
- `DealResponse.contacts` (from `listDeals` / `getDeal`) gives the same membership as `ContactBrief` rows with numeric `id`.

#### `g8.api.deals.getContactDeals` — `get_contact_deals_contacts__contact_id__deals_get` — GET /api/v1/contacts/{contact_id}/deals (read, `deals:read`)

- path: `{ contact_id: number }`
- 200 envelope, `data: Array<ContactDealResponse>` (amount is `value`, stage is `stage`)

#### Other membership operations

| call | operationId | route | tier / scope | input | 200 |
|---|---|---|---|---|---|
| `deals.addDealContact` | `add_deal_contact_deals__deal_id__contacts_post` | POST /deals/{deal_id}/contacts | write, `deals:write` | path `deal_id: string`; body `{ person_id: string; role?: string \| null }` | envelope `DealContact` |
| `deals.removeDealContact` | `remove_deal_contact_deals__deal_id__contacts__person_id__delete` | DELETE /deals/{deal_id}/contacts/{person_id} | destructive, `deals:delete` | path `{ deal_id: string; person_id: string }` | `void` |
| `deals.setDealContactRole` | `set_deal_contact_role_deals__deal_id__contacts__contact_id__put` | PUT /deals/{deal_id}/contacts/{contact_id} | write | path `{ deal_id: string; contact_id: number }`; body `{ role: string \| null }` | envelope `ContactBrief` |
| `deals.setPrimaryDealContact` | — | PUT /deals/{deal_id}/contacts/{person_id}/primary | write | — | — |
| `deals.getCompanyDeals` | `get_company_deals_companies__company_id__deals_get` | GET /companies/{company_id}/deals | read | path `company_id: number` | envelope `ContactDealResponse[]` |
| `assertUpsert.assertDealContact` | `assert_deal_contact_contacts__contact_id__deals_assert_put` | PUT /contacts/{contact_id}/deals/assert | write, `contacts:write` | — | — |

### Other deal operations (brief)

- `deals.listDealLineItems` (GET /deals/{deal_id}/line-items, read) returns envelope `DealLineItemsPayload = { deal_id: string; amount?: number | null; currency?: string | null; line_items?: DealLineItemRecord[]; linked_quote_total?: number | null; amount_mismatch?: boolean }`.
- `deals.listDealHistory` (GET /deals/{deal_id}/history, read): query `{ limit?; offset? }`. It returns untyped `DealCollectionPayload`.
- `deals.listDealColumns` (GET /deals/columns): query `{ list_id?: number | null }`. It returns untyped `DealCollectionPayload`.
- `deals.setDealColumnValues` (PUT /deals/{deal_id}/columns/values, write): body `{ values: Record<string, string | number | boolean | null> }`, query `{ list_id? }`. It returns untyped `DealPayload`.
- **Billable:** `deals.generateDealDocument`, `generateAllDealDocuments`, `regenerateDealDocument` and `revenueRecords.unlockLifecycleContacts`.
- **Destructive:** `deals.deleteDeal`, `deals.mergeDeal`.

---

## 2. Quotes (tag `quotes`)

IDs: `quote_id` is a `string` (UUID). `mashup_company_id` and `signer_contact_id` are `number`. `deal_id` is a `string` (UUID). Money in line items is in **cents** (`unit_amount`).

### `g8.api.quotes.listQuotes` — `list_quotes_quotes_get` — GET /api/v1/quotes (read, `quotes:read`)

- query?:
  - `status?: string | null`. The documented values are draft, sent, viewed, accepted, declined, voided and expired. Use `status: "sent"` for sent quotes.
  - `mashup_company_id?: number | null`
  - `deal_id?: string | null`
  - **`owner_id?: string | null`**. This filter takes an **email**.
  - `page?: number`, `limit?: number`
- 200 envelope, `data: QuoteListResponse = { items: Array<QuoteSummary>; page: number; limit: number; total: number }`
  - This is **not** `data[]`. The rows are in `res.data.items`.
- `QuoteSummary`: `{ id?: string | null; quote_number?: string | null; title?: string | null; status?: string | null; total?: number | null; currency?: string | null; sent_at?: string | null; accepted_at?: string | null; created_at?: string | null; [key: string]: unknown }`
  - The summary has no typed deal id, owner, contact or expiry.
  - A "viewed" quote has already been sent, so a "sent" filter may miss quotes the recipient has opened.

### `g8.api.quotes.getQuote` — `get_quote_quotes__quote_id__get` — GET /api/v1/quotes/{quote_id} (read, `quotes:read`)

- path: `{ quote_id: string }`
- 200 envelope, `data: QuoteDetail`:
  `{ id?: string | null; quote_number?: string | null; title?: string | null; status?: string | null; line_items?: Array<Record<string, unknown>> | null; activity?: Array<Record<string, unknown>> | null; envelope?: Record<string, unknown> | null; [key: string]: unknown }`
- **Mostly untyped.** The type does not declare total, currency, valid_until/expiry, owner/sender, signer/recipient contact or deal_id. Line items are untyped records.
- The write model (`QuoteCreateRequest` / `QuoteUpdateRequest`) uses these names, which the detail probably echoes (unverified): `valid_until`, `owner_id`, `deal_id`, `currency`, `tax_amount`, `signer_contact_id`, `signer_email`, `signer_name`, `billing_contact_id`, `billing_email`, `mashup_company_id`, `payment_terms`, `contract_*`, and `line_items[]` with `{ product_name, unit_amount /* cents */, quantity, discount_pct, billing_frequency, description, ... }`.
- Read these fields defensively.

### Other quote reads

| call | operationId | route | input | 200 |
|---|---|---|---|---|
| `quotes.getContactQuotes` | `get_contact_quotes_contacts__contact_id__quotes_get` | GET /contacts/{contact_id}/quotes | path `contact_id: number` (**the quote signer**) | envelope `QuoteDetail[]` |
| `quotes.getCompanyQuotes` | `get_company_quotes_companies__company_id__quotes_get` | GET /companies/{company_id}/quotes | path `company_id: number` | envelope `QuoteDetail[]` |
| `quotes.getQuotePdf` | `get_quote_pdf_quotes__quote_id__pdf_get` | GET /quotes/{quote_id}/pdf | path `quote_id: string` | envelope `QuotePayload` (untyped) |
| `quotes.listQuoteEvidence` | — | GET /quotes/{quote_id}/evidence | path `quote_id` | — |
| `quotes.searchQuoteContacts` | `search_quote_contacts_quote_contacts_get` | GET /quote-contacts | query `{ q?: string; limit?: number; company_id?: number \| null; deal_id?: string \| null }` | envelope `QuoteListPayload` (untyped) |
| `quotes.previewQuoteSend` | — | POST /quotes/{quote_id}/send-preview (read) | — | — |

### DO NOT USE — operations that edit, void, send or change the state of a quote

Every operation here is `external` (no blind retry) or `destructive`.

| call | operationId | route | tier / scope | input |
|---|---|---|---|---|
| `quotes.updateQuotePatch` | `update_quote_quotes__quote_id__patch` | PATCH /quotes/{quote_id} | external, `quotes:run` | body `QuoteUpdateRequest` (all optional; same fields as create) |
| `quotes.updateQuotePut` | `update_quote_quotes__quote_id__put` | PUT /quotes/{quote_id} | external, `quotes:run` | body `QuoteUpdateRequest` |
| `quotes.editQuoteAsDraft` | `edit_quote_as_draft_quotes__quote_id__edit_as_draft_post` | POST /quotes/{quote_id}/edit-as-draft | external | the source must be `sent`; returns `data: Record<string, unknown>` |
| `quotes.revokeQuote` | `revoke_quote_quotes__quote_id__revoke_post` | POST /quotes/{quote_id}/revoke | destructive, `quotes:delete` | path only (this is the void) |
| `quotes.expireQuote` | `expire_quote_quotes__quote_id__expire_post` | POST /quotes/{quote_id}/expire | destructive | path only |
| `quotes.archiveQuote` | `archive_quote_quotes__quote_id__archive_post` | POST /quotes/{quote_id}/archive | destructive | path only |
| `quotes.unarchiveQuote` | `unarchive_quote_quotes__quote_id__unarchive_post` | POST /quotes/{quote_id}/unarchive | external | path only |
| `quotes.deleteQuote` | `delete_quote_quotes__quote_id__delete` | DELETE /quotes/{quote_id} | destructive | path only |
| `quotes.batchQuoteAction` | `batch_quote_action_quotes_batch_post` | POST /quotes/batch | external | body `{ action: "archive" \| "expire" \| "revoke"; quote_ids: string[] }` |
| `quotes.sendQuote` | `send_quote_quotes__quote_id__send_post` | POST /quotes/{quote_id}/send | external | body? `{ subject?; message? }`; the quote must be draft or sent (this resends) |
| `quotes.markQuoteAccepted` | `mark_quote_accepted_quotes__quote_id__mark_accepted_post` | POST /quotes/{quote_id}/mark-accepted | external | body `{ evidence_type: "offline_signature" \| "customer_email" \| "verbal_authorization" \| "payment_received"; evidence_note: string }` |
| `quotes.duplicateQuote` | `duplicate_quote_quotes__quote_id__duplicate_post` | POST /quotes/{quote_id}/duplicate | external | path only |
| `quotes.createQuote` | `create_quote_quotes_post` | POST /quotes | external | body `QuoteCreateRequest` (required: `title`, `line_items[]` with `product_name` and `unit_amount` in cents) |
| `quotes.uploadQuoteEvidence` | — | POST /quotes/{quote_id}/evidence | write | — |

Related webhook events: `quote.sent`, `quote.resent`, `quote.viewed`, `quote.accepted`, `quote.declined`, `quote.expired`, `quote.voided` and others (see section 6).

---

## 3. Scheduling / booking (tag `appointments`, plus `gtmLaunchHelpers.listEventTypes`)

**IDs:**

- `event_type_id` is a `number`.
- `booking_uid` is a `string` (UUID).
- Host `user_id` and `host_user_id` are a **`number`**. This is not the string `owner_id` used elsewhere.
- Host group `group_id` is a `string`.
- Slot `slot_uid` is a `string`.

Most appointments responses are **untyped and not enveloped** (`Record<string, unknown>`).

### Event types ("booking links")

There is **no `GET /appointments/event-types` list** in ops.json. The list lives under another tag:

#### `g8.api.gtmLaunchHelpers.listEventTypes` — `list_event_types_event_types_get` — GET /api/v1/event-types (read, **`campaigns:read`**)

- query?: `{ include_hidden?: boolean /* default false */; scheduling_type?: string | null /* managed | round_robin | collective */ }`
- 200 `EventTypesListResponse = { data: Array<EventTypeListItem> }`. It has **no pagination key**.
- `EventTypeListItem`:
  `{ id: number /* pass as appointment_id / event_type_id */; slug: string; title: string; length: number /* minutes */; description?: string | null; hidden?: boolean; schedule_id?: number | null; scheduling_type?: string | null /* null = single-host */ }`

#### `g8.api.appointments.getEventType` — `get_event_type_appointments_event_types__event_type_id__get` — GET /api/v1/appointments/event-types/{event_type_id} (read, `meetings:read`)

- path: `{ event_type_id: number }`
- 200 `Record<string, unknown>` (untyped, not enveloped)

Other event-type operations:

- **Write:** `createEventType`, `updateEventType`, `duplicateEventType`, `setLockedFields`, `getEmbedConfig` / `updateEmbedConfig`, `get/setEventTypeSelectedCalendars`, `get/set/clearEventTypeDestinationCalendar`, `assignManagedMember`, `assignAllMembers`.
- **Destructive:** `deleteEventType`, `unassignManagedMember`.
- `webChat.listWebchatTeamEventTypes` also exists (GET /webchat/teams/{team_id}/event-types).

### Hosts and host groups

| call | operationId | route | tier / scope | input | 200 |
|---|---|---|---|---|---|
| `appointments.addEventTypeHost` | `add_event_type_host_appointments_event_types__event_type_id__hosts_post` | POST /appointments/event-types/{event_type_id}/hosts | write, `meetings:write` | path `event_type_id: number`; body `AppointmentHostCreateRequest` | envelope `AppointmentHost` |
| `appointments.updateEventTypeHost` | `update_event_type_host_appointments_event_types__event_type_id__hosts__host_user_id__patch` | PATCH .../hosts/{host_user_id} | write | path `{ event_type_id: number; host_user_id: number }`; body `{ group_id?: string \| null; is_fixed?: boolean \| null; priority?: number \| null; schedule_id?: number \| null; weight?: number \| null }` | envelope `AppointmentHost` |
| `appointments.removeEventTypeHost` | `remove_event_type_host_appointments_event_types__event_type_id__hosts__host_user_id__delete` | DELETE .../hosts/{host_user_id} | destructive, `meetings:delete` | path `{ event_type_id: number; host_user_id: number }` | `void` |
| `appointments.listEventTypeHostGroups` | `list_event_type_host_groups_appointments_event_types__event_type_id__host_groups_get` | GET .../host-groups | read | path `event_type_id: number` | envelope `AppointmentHostGroup[]` |
| `appointments.createEventTypeHostGroup` | `create_event_type_host_group_appointments_event_types__event_type_id__host_groups_post` | POST .../host-groups | write | body `{ name: string }` | envelope `AppointmentHostGroup` |
| `appointments.updateEventTypeHostGroup` | — | PATCH .../host-groups/{group_id} | write | — | — |
| `appointments.deleteEventTypeHostGroup` | `delete_event_type_host_group_appointments_event_types__event_type_id__host_groups__group_id__delete` | DELETE .../host-groups/{group_id} | destructive | path `{ event_type_id: number; group_id: string }` | `void` |

- `AppointmentHostCreateRequest = { user_id: number /* required */; is_fixed?: boolean /* true = on every booking; false = round-robin member */; group_id?: string | null; priority?: number | null; weight?: number | null; schedule_id?: number | null }`
- `AppointmentHost = { user_id?: number | null; event_type_id?: number | null; email?; name?; avatar_url?; is_fixed?: boolean | null; group_id?: string | null; priority?: number | null; weight?: number | null; schedule_id?: number | null; [key: string]: unknown }`
- `AppointmentHostGroup = { id?: string | null; event_type_id?: number | null; name?: string | null; created_at?; [key: string]: unknown }`
- There is **no "list hosts" operation**. Hosts are presumably inside the untyped `getEventType` payload.

### Bookings

#### `g8.api.appointments.listBookings` — `list_bookings_appointments_bookings_get` — GET /api/v1/appointments/bookings (read, `meetings:read`)

- query?:
  - `status?: string | null` (accepted | pending | cancelled | rejected)
  - `event_type_id?: number | null`
  - `after_start?: string | null`, `before_end?: string | null` (ISO 8601)
  - `attendee_email?: string | null`
  - `sort_by?: string` (start_time | end_time | created_at | status), `sort_order?: string`
  - **`skip?: number`, `take?: number`** (not page/limit)
- 200 `Record<string, unknown>` (untyped, not enveloped)
- The operation lists "the caller's bookings", which means bookings scoped to the API key's user.

#### `g8.api.appointments.getBooking` — `get_booking_appointments_bookings__booking_uid__get` — GET /api/v1/appointments/bookings/{booking_uid} (read)

- path: `{ booking_uid: string }`
- 200 `Record<string, unknown>` (untyped)

#### `g8.api.appointments.createBooking` — `create_booking_appointments_bookings_post` — POST /api/v1/appointments/bookings (**external**, `meetings:run`)

- JSDoc summary: "Create a booking (**charges credits** + sends notifications)".
- The ops tier is `external`, not `billable`. The route is in `EXTERNAL_ROUTES`, so there is no retry on 5xx.
- body (required) `CreateBookingRequest`:
  - `event_type_id: number` (required)
  - `start_time: string` (required, ISO 8601)
  - `end_time?: string | null`
  - `attendees: Array<AttendeeInput>` (required). `AttendeeInput = { name: string; email: string; time_zone?: string | null; phone_number?: string | null }`
  - `guests?: string[] | null`
  - `language?: string`
  - `location?: string | null`, `selected_location?: LocationItem | null`, `selected_conferencing?: LocationItem | null`
  - `metadata?: Record<string, unknown> | null`, `responses?: Record<string, unknown> | null`
  - `slot_uid?: string | null` (from `reserveSlot`)
  - `override_availability?: boolean`
  - `recurring_event_id?: string | null`
- `LocationItem = { kind: "in_person_host" | "in_person_attendee" | "phone_host" | "phone_attendee" | "link" | "conferencing" | "custom"; address?; link?; phone?; provider?; display_label?; public?: boolean }`
- 200 `Record<string, unknown>` (untyped, not enveloped)

#### `g8.api.appointments.cancelBooking` — `cancel_booking_appointments_bookings__booking_uid__cancel_post` — POST /api/v1/appointments/bookings/{booking_uid}/cancel (destructive, `meetings:delete`)

- JSDoc: "Cancel a booking and **notify both parties**".
- path: `{ booking_uid: string }`
- body?: `CancelBookingRequest | null = { cancellation_reason?: string | null; cancel_subsequent?: boolean }`
- 200 `Record<string, unknown>`

#### Slots

- `g8.api.appointments.getAvailableSlots` — `get_available_slots_appointments_slots_get` — GET /appointments/slots (read)
  - query (**required**): `{ event_type_id: number; start: string; end: string /* at most 60 days after start */; time_zone?: string | null; duration?: number | null }`
  - 200 envelope `SchedulingPayload` (untyped)
- `g8.api.appointments.reserveSlot` — `reserve_slot_appointments_slots_reserve_post` — POST /appointments/slots/reserve (write)
  - body `{ event_type_id: number; slot_start: string; slot_end: string }`
  - 200 envelope `SchedulingPayload` (untyped)
- `appointments.releaseSlot` (DELETE /appointments/slots/reserve/{slot_uid}, destructive)

#### Other booking operations

All of these are `external` with scope `meetings:run` unless noted:

- `confirmBooking`, `rescheduleBooking`, `requestBookingReschedule`, `addBookingGuests`, `addBookingNote`, `markAbsent`
- `updateBookingLocation` (PATCH)
- `updateBookingSequence` (PATCH /appointments/bookings/{booking_uid}/sequence)
- `importMeeting` (POST /appointments/bookings/import)
- Read: `getBookingInsights`, `exportBookingInsights`, `listSequencesForPicker`
- `meetings.meetingsBooked` (GET /inbox/meetings/booked, read)
- Booking workflows (Cal-style reminders): `appointments.listWorkflows`, `createWorkflow`, `updateWorkflow`, `toggleWorkflow` (external), `deleteWorkflow`

### Public booking link (not part of `g8.api`)

`g8.calendar` (`createCalendarClient`, `dist/index.js`) is described as "Public endpoints - no API key needed". It does **not** add `/api/v1`:

- `g8.calendar.show(config)` / `embed(selector, config)` open an iframe at `${apiUrl}/appointments/${username}/${eventType}`. `CalendarConfig = { eventType: string /* slug */; username: string; prefill?: { name?; email?; notes? } }`.
- `g8.calendar.slots(username, eventSlug, { start, end })` calls GET `${apiUrl}/appointments/public/slots?username=&event_slug=&start_date=&end_date=`. It returns `TimeSlot[] = { start; end; available }[]`, or `[]` on a non-2xx response.
- `g8.calendar.book(req)` calls POST `${apiUrl}/appointments/public/bookings` with `BookingRequest = { event_type_id: number; slot: string; attendee: { name: string; email: string; notes?: string } }`.
  - It returns `Booking | null = { uid; confirmation_url; start_time; end_time }`.
  - It returns **`null` on any non-2xx response** instead of throwing.
  - It sends no auth header and does no retry.

---

## 4. Custom fields (contacts)

Custom column ids (`column_id`) are **`number`**. Record ids are `number`.

- The `fields.*` operations use `entity: 'contacts' | 'companies'` (plural).
- `contacts.listCustomColumnDefinitions` and `listSearchableFields` use `entity_type: 'contact' | 'company'` (singular).

### Create a custom field

#### `g8.api.fields.createField` — `create_field_fields_post` — POST /api/v1/fields (write, `fields:write`)

- body (required) `CreateFieldRequest`:
  - `title: string` (required; the display title)
  - `data_type?: string`. **Only `'text'` is supported.**
  - `entity?: string` (`'contacts'` or `'companies'`)
  - `list_id?: number | null`. When set, the field is list-scoped; when omitted, it is **org-global and appears on every list**.
  - `enrichment?: CreateFieldEnrichmentInput | null` (optional waterfall pipeline; leave it out)
- 200 envelope, `data: CreateFieldResponse = { id: number; name: string /* slug */; title: string; data_type: string; is_global: boolean; list_id?: number | null; enrichment?: ... | null }`

#### `g8.api.fields.createFieldsBatch` — `create_fields_batch_fields_batch_post` — POST /api/v1/fields/batch (write)

- body `{ fields: Array<{ title: string; data_type?: string; enrichment?: ... }> /* 1-100 */; entity?: string; list_id?: number | null }`
- 200 envelope:
  - `data: { entity: string; list_id?: number | null; results: Array<BatchFieldResult>; total_created: number; total_requested: number }`
  - `BatchFieldResult = { title: string; id?: number | null; name?: string | null; ok?: boolean; error?: string | null; is_global?: boolean; list_id?: number | null; enrichment? }`

#### `g8.api.contacts.createContactColumn` — `create_contact_column_contacts_columns_create_post` — POST /api/v1/contacts/columns/create (write, `contacts:write`)

- body `CreateContactColumnRequest`:
  - `title: string` (required)
  - **`created_by: string`** (required; the creator's email)
  - `data_type?: "text" | "int" | "numeric" | "boolean"`. The JSDoc still says only text is supported.
  - `list_id?: number | null`
  - `enrichment?` (the JSDoc labels it "STRONGLY RECOMMENDED", but it is only needed for the Enrich button)
- 200 envelope, `data: { id?: number | null; name?: string | null; title: string; data_type?; object_id?: string | null; is_global?: boolean; enrichment? }`
- The destructive counterpart is `contacts.deleteContactColumn` (DELETE /contacts/columns/{column_id}).

#### Listing and deleting fields

- `g8.api.fields.listContactFields` — `list_contact_fields_fields_get` — GET /fields (read)
  - query `{ list_id?: number | null }`. Without `list_id`, only the global fields are returned.
  - 200 envelope `Array<FieldResponse>`, where `FieldResponse = { id?: number | null; name?: string | null /* slug */; title: string; data_type?: string; is_global?: boolean }`
- `fields.listCompanyFields` (GET /fields/companies) has the same shape.
- `contacts.listCustomColumnDefinitions` (GET /contacts/custom-column-definitions; query `entity_type?`) returns untyped `CrmCollectionPayload`.
- `contacts.listContactColumns` (GET /contacts/columns) is also available.
- `g8.api.fields.deleteField` — `delete_field_fields__column_id__delete` — DELETE /fields/{column_id} (destructive, `fields:delete`)
  - query `{ entity?: string; list_id?: number | null /* guard: 404 if the column is not on this list */ }`
  - 200 envelope `{ column_id: number; deleted?: boolean }`

### Set a value on a contact

1. `g8.api.fields.setFieldValue` — `set_field_value_fields__column_id__values_patch` — PATCH /api/v1/fields/{column_id}/values (write, `fields:write`)
   - path `{ column_id: number }`
   - body `{ record_id: number; value?: string | null /* null clears it */; entity?: string }`
   - 200 envelope `{ column_id: number; record_id: number; updated?: boolean }`
2. `g8.api.fields.setFieldValuesBatch` — `set_field_values_batch_fields_values_batch_patch` — PATCH /api/v1/fields/values/batch (write)
   - body `{ rows: Array<{ record_id: number; fields?: Array<{ column_id: number; value?: string | null }> }> /* 1-500 */; entity?: string; strict?: boolean }`
   - By default the response is always HTTP 200 with per-row results. With `strict: true`, a batch where every row fails returns 422 and a partial failure returns 207.
   - 200 envelope `{ entity; results: Array<{ record_id: number; ok?: boolean; error?: string | null; updated_columns?: number[] }>; total_rows_requested; total_rows_updated; total_values_written; total_rows_failed?; all_failed? }`
3. At create time, `contacts.createContacts` (POST /contacts) accepts `custom_fields?: Record<string, string | null> | null` and `create_missing_fields?: boolean`.
   - Keys can be the display title, the slug (for example `udo_followup_1_ab12cd34`), or a case or space variant of the title.
   - The response includes `custom_fields?: CustomFieldWriteReport = { written?: string[]; ignored?: string[]; created?: string[] }`. Unknown keys are **silently ignored** unless `create_missing_fields` is true.
4. For upserts, `assertUpsert.assertContact` — `assert_contact_contacts_assert_put` — PUT /contacts/assert (write, `contacts:write`).
   - body `ContactAssertRequest`: the same contact fields plus `custom_fields?` and `create_missing_fields?`, with **`list_id: number` required**.
   - The match key is `work_email`, then `linkedin_url`.
   - 200 envelope `{ action: string /* 'created' | 'updated' */; count?: number; custom_fields?: CustomFieldWriteReport }`
   - Batch variant: `assertContactsBatch` (PUT /contacts/assert/batch).
5. **`contacts.updateContact` (PATCH /contacts/{contact_id}) has no `custom_fields`**. `ContactUpdateRequest` only has the standard columns: first_name, last_name, work_email, job_title, phones, linkedin_url, city, state, country, company_id, company_domain, seniority_level and job_department.
6. `contacts.bulkUpdateContacts` (POST /contacts/bulk-update) takes `Array<Record<string, unknown>>` and returns an untyped response. It is not recommended.

### Read a value

- `g8.api.fields.getFieldValue` — `get_field_value_fields__column_id__values_get` — GET /fields/{column_id}/values (read)
  - path `{ column_id: number }`
  - query (**required**) `{ record_id: number; entity?: string }`
  - 200 envelope `{ column_id: number; record_id: number; entity: string; name: string /* slug */; value?: string | null }`
- `contacts.getContact` and `contacts.listContacts` take the query `include_custom_fields?: boolean`. The rows then carry `custom_fields?: Record<string /* slug */, string | null> | null`, keyed by **slug**, not title.
- `lists.getListContacts` returns `ContactListItem` (which has `custom_fields?`) but declares **no `include_custom_fields` query**.

### Filter contacts by custom-field value

- **No typed query param exists for this.** `listContacts` filters only on standard columns.
- `g8.api.contacts.fetchContacts` — `fetch_contacts_contacts_fetch_post` — POST /contacts/fetch (read)
  - body `{ filter?: string | null /* "Serialized per-column filter JSON" */; mapping_columns?: string[] | null; page?: number; limit?: number }`
  - The filter grammar is **undocumented** in the types, and the response is untyped `CrmCollectionPayload`.
- `contacts.listSearchableFields` (GET /contacts/searchable-fields) may list the filterable keys, but its response is untyped.
- The practical option is `listContacts({ query: { list_id, include_custom_fields: true } })` and filtering by slug on the client.
- `search.searchContacts` (POST /search/contacts) is **billable**. Avoid it.

---

## 5. Contact notes and tasks (cleanup)

### Notes (tag `notes`)

Note ids are `string`. Contact id in a path is `number`. In the generic `/notes` API, `entity_id` is a `string`.

| call | operationId | route | tier / scope | input | 200 |
|---|---|---|---|---|---|
| `notes.createNote` | `create_note_contacts__contact_id__notes_post` | POST /contacts/{contact_id}/notes | write, `notes:write` | path `contact_id: number`; body `{ content: string }` | envelope `NoteResponse` |
| `notes.listNotes` | `list_notes_contacts__contact_id__notes_get` | GET /contacts/{contact_id}/notes | read, `notes:read` | path `contact_id: number`; no query | envelope `NoteResponse[]` |
| `notes.deleteNote` | `delete_note_notes__note_id__delete` | DELETE /notes/{note_id} | destructive, `notes:delete` | path `note_id: string` | envelope `Record<string, unknown>` |
| `notes.updateNote` | — | PATCH /notes/{note_id} | write | — | — |
| `notes.createRecordNote` | `create_record_note_notes_post` | POST /notes | write | body `{ content: string; entity_type?: string; entity_id?: string; mentioned_users?: Array<{ id: string; name: string; email?: string \| null }>; records?: Array<Record<string, unknown>> \| null; source_url?: string \| null }` | envelope `CrmRecordPayload` (untyped) |
| `notes.listNotesForRecord` | `list_notes_for_record_notes_get` | GET /notes | read | query (**required**) `{ entity_type: string /* contact \| company \| deal */; entity_id: string }` | envelope `CrmCollectionPayload` (untyped) |
| `notes.listNotesForContacts` | — | POST /notes/batch (read) | — | — | — |

`NoteResponse` is defined in section 1. `NoteCreateRequest` has only `content`, so there is no author or mention field on the per-contact create.

### Tasks (tag `tasks`; create is documented in `docs/endpoints.md` §6)

#### `g8.api.tasks.listAllTasks` — `list_all_tasks_tasks_get` — GET /api/v1/tasks (read, `tasks:read`)

- query?:
  - `status?: string | null` (open | completed)
  - `priority?: number | null`
  - `assignee_id?: string | null`
  - `created_by?: string | null` (email or user id)
  - `task_type?: string | null`
  - `entity_type?: string | null` (contact | company | deal | team_member)
  - `entity_id?: string | null` (a **string**, even for numeric contact ids; pair it with `entity_type`)
  - `source_meeting_id?: number | null`
  - `search?: string | null` (title)
  - **`limit?: number` (default 100, max 200), `offset?: number`**
- 200 envelope, `data: Array<TaskResponse>` (see `docs/endpoints.md` §6)
- To list one contact's tasks, use `tasks.listContactTasks` — `list_contact_tasks_contacts__contact_id__tasks_get` — GET /contacts/{contact_id}/tasks (path `contact_id: number`, query `{ status? }`). It returns envelope `TaskResponse[]`.

#### `g8.api.tasks.getTask` — `get_task_tasks__task_id__get` — GET /api/v1/tasks/{task_id} (read)

- path `{ task_id: string }`
- 200 envelope `TaskResponse`

#### Complete a task: `g8.api.tasks.updateTask` — `update_task_tasks__task_id__patch` — PATCH /api/v1/tasks/{task_id} (write, `tasks:write`)

- path `{ task_id: string }`
- body `TaskUpdateRequest`, every field optional:
  - **`status?: string | null` (`"completed"` to complete, `"open"` to reopen)**
  - `title?`, `description?`, `due_date?`, `assignee_id?`
  - `priority?: number | null`
  - `task_type?`, `tags?: string[] | null`
  - `records?: Array<Record<string, string>> | null` (`[]` unlinks everything)
  - `parent_task_id?`, `subtask_sort_order?`
  - `expected_updated_at?: string | null` (optimistic-concurrency guard)
- 200 envelope `TaskResponse`
- There is no dedicated `/complete` operation. `tasks.resolveTaskThread` (POST /tasks/{id}/resolve) resolves the comment **thread**, not the task status.

#### `g8.api.tasks.deleteTask` — `delete_task_tasks__task_id__delete` — DELETE /api/v1/tasks/{task_id} (destructive, `tasks:delete`)

- path `{ task_id: string }`
- 200 envelope `Record<string, unknown>`

Avoid `tasks.startTaskExecution` (POST /tasks/{task_id}/start). It is **billable**.

---

## 6. Webhooks, event feed, workflows

### Webhook subscriptions (tag `webhooks`)

Webhook ids are `string`. Every create, update and rotate operation is `external` (no blind retry).

| call | operationId | route | tier / scope | input | 200 |
|---|---|---|---|---|---|
| `webhooks.listWebhookEvents` | `list_webhook_events_webhooks_events_get` | GET /webhooks/events | read, `webhooks:read` | none | envelope `Array<{ event: string; category?: string \| null; description?: string \| null }>` |
| `webhooks.listWebhooks` | `list_webhooks_webhooks_get` | GET /webhooks | read | query `{ is_active?: boolean \| null }` | envelope `WebhookResponse[]` |
| `webhooks.createWebhook` | `create_webhook_webhooks_post` | POST /webhooks | **external**, `webhooks:run` | body `{ url: string; events: string[]; name?: string \| null }` | envelope `WebhookResponse` (includes `secret`) |
| `webhooks.getWebhook` | `get_webhook_webhooks__webhook_id__get` | GET /webhooks/{webhook_id} | read | path `webhook_id: string` | envelope `WebhookResponse` |
| `webhooks.updateWebhook` | `update_webhook_webhooks__webhook_id__patch` | PATCH /webhooks/{webhook_id} | external | body `{ url?; events?: string[] \| null; is_active?: boolean \| null; name? }` | envelope `WebhookResponse` |
| `webhooks.deleteWebhook` | `delete_webhook_webhooks__webhook_id__delete` | DELETE /webhooks/{webhook_id} | destructive, `webhooks:delete` | path | `void` |
| `webhooks.listWebhookDeliveries` | `list_webhook_deliveries_webhooks__webhook_id__deliveries_get` | GET /webhooks/{webhook_id}/deliveries | read | query `{ page?; limit?; status?: string \| null }` | envelope `Array<{ id: string; event: string; status: string; attempts?: number; max_attempts?: number; response_code?: number \| null; error_message?; created_at?; completed_at? }>` |
| `webhooks.rotateWebhookSecret` | `rotate_webhook_secret_webhooks__webhook_id__rotate_secret_post` | POST /webhooks/{webhook_id}/rotate-secret | external | path | envelope `WebhookResponse` (includes the new `secret`) |

- `WebhookResponse = { id: string; url: string; events?: string[]; is_active?: boolean; name?: string | null; secret?: string | null /* only on create and rotate-secret */; created_at?; updated_at? }`
- **Delivery format** (`g8.webhooks.constructEvent`):
  - The body is `{ event: string; timestamp: string; data: Record<string, unknown>; org_id: string; id?: string /* dedupe key */ }`.
  - The signature is HMAC-SHA256 hex of `` `${timestamp}.${rawBody}` `` in `X-Studio-Signature`, with the unix timestamp in `X-Studio-Timestamp` and the delivery id in `X-Studio-Delivery-Id`.
  - `constructEvent` throws `WebhookSignatureError`.
- Webhooks are push-only. `g8.webhooks` has no polling.

**Known event names** (`KNOWN_WEBHOOK_EVENTS` in the SDK; `WebhookEvent` also accepts any string). Relevant subsets:

- **Sequence:** `sequence.draft_created`, `sequence.started`, `sequence.paused`, `sequence.completed`, `sequence.contact_enrolled`, `sequence.contact_removed`, `sequence.step_completed`, `sequence.step_failed`.
  - There is **no `sequence.updated` or step-edited event**. `step_completed` and `step_failed` are per-contact execution events, not edits to the step definition.
- **Email / engagement:** `engagement.email_sent`, `engagement.email_replied`, `engagement.email_bounced`, `engagement.email_skipped`, `engagement.email_clicked`, `engagement.link_clicked`, `engagement.contact_unsubscribed`, plus sms/whatsapp/linkedin/call variants.
- **Bookings:** `meeting.booked`, `meeting.cancelled`, `meeting.rescheduled`, `meeting.no_show`.
  - The names use `meeting.*`, not `booking.*`. The internal event feed uses `booking_created` (see below).
- **Deals:** `deal.created`, `deal.updated`, `deal.stage_changed`, `deal.won`, `deal.deleted`.
- **Quotes:** `quote.created`, `quote.updated`, `quote.sent`, `quote.resent`, `quote.resend_failed`, `quote.link_generated`, `quote.viewed`, `quote.accepted`, `quote.declined`, `quote.expired`, `quote.voided`, `quote.superseded`, `quote.archived`, `quote.unarchived`, `quote.payment_received`, `quote.payment_failed`, `quote.subscription_canceled`, `quote.provisioned`.
- **Tasks / CRM / workflow:** `task.created`, `task.updated`, `task.completed`, `task.deleted`, `crm.record.created`, `crm.record.updated`, `crm.record.archived`, `crm.record.restored`, `workflow.execution_completed`, `workflow.execution_failed`.
- **Other:** `campaign.*`, `document.*`, `intelligence.*`, `company.enriched`, `audience.*`, `voice_ai.*`, `form.submitted`, `visitor.identified`, `intent.signal`, `enrichment.job_*`.

Call `listWebhookEvents` for the server's authoritative list.

### Event feed (pull alternative): `g8.api.events.listOrgEvents` — `list_org_events_events_get` — GET /api/v1/events (read, **`analytics:read`**)

- query?:
  - `type?: string[] | null` (for example sequencer, inbox, voiceai, appointments, crm, deals, quotes)
  - `name?: string[] | null` (for example `sequence_email_sent`, `sequence_email_replied`, `booking_created`)
  - `source?: string | null`
  - `contact_id?: string | null`, `sequence_id?: string | null`, `campaign_id?: string | null`
  - `since?: string | null` (default: 7 days before `until`), `until?: string | null` (exclusive; default now)
  - `cursor?: string | null`, `limit?: number`
- 200 envelope, `data: OrgEventFeedPage = { events?: OrgEventItem[]; has_more?: boolean; next_cursor?: string | null /* older page */; since: string; until: string }`
- `OrgEventItem = { id?: string | null /* stable, dedupe */; name?: string | null; type?: string | null; source?: string | null; occurred_at?: string | null; actor_email?: string | null; contact_id?: string | null; sequence_id?: string | null; campaign_id?: string | null; url?: string | null; message?: Record<string, unknown> }`
- Caveats:
  - The array params are typed as "repeatable", but the SDK's `buildQuery` sends `String(array)`, which is comma-joined. **Pass one value per call.**
  - The feed uses **snake_case names** (`sequence_email_sent`), unlike the dotted webhook names.
  - `contact_id` is a string here.

### Workflows (tag `workflows`)

Workflow id = `action_id: string`. Execution id = `execution_id: string` (UUID). **Every workflow payload is untyped and not enveloped** (`Record<string, unknown>`), except `listRecentWorkflowRuns`.

| call | operationId | route | tier / scope | input | 200 |
|---|---|---|---|---|---|
| `workflows.listWorkflows` | `list_workflows_workflows_get` | GET /workflows | read, `workflows:read` | query `{ enabled?: boolean \| null; category?: string \| null; is_template?: boolean \| null }` | `Record<string, unknown>` |
| `workflows.getWorkflow` | `get_workflow_workflows__action_id__get` | GET /workflows/{action_id} | read | path `action_id: string` | `Record` (the full graph) |
| `workflows.executeWorkflow` | `execute_workflow_workflows__action_id__execute_post` | POST /workflows/{action_id}/execute | **external**, `workflows:run` | path; body? `Record<string, unknown>` | `Record` |
| `workflows.listWorkflowExecutions` | `list_workflow_executions_workflows_executions_get` | GET /workflows/executions | read | query `{ action_id?: string \| null; status_filter?: string \| null /* pending\|running\|completed\|failed\|paused\|pending_approval\|stopped; one per call */; triggered_by?: string \| null; limit?: number /* 1..200 */; offset?: number }` | `Record` |
| `workflows.getExecution` | `get_execution_workflows_executions__execution_id__get` | GET /workflows/executions/{execution_id} | read | path `execution_id: string` | `Record` |
| `workflows.listRecentWorkflowRuns` | `list_recent_workflow_runs_workflows__action_id__runs_recent_get` | GET /workflows/{action_id}/runs/recent | read | path `action_id`; query `{ limit? }` | envelope `VoiceListPayload = { items?: unknown[] }` |
| `workflows.getTriggerStatus` | `get_trigger_status_workflows__action_id__trigger_status_get` | GET /workflows/{action_id}/trigger-status | read | path | `Record` |
| `workflows.createWorkflow` | `create_workflow_workflows_post` | POST /workflows | external | body `Record<string, unknown>` (untyped) | `Record` |
| `workflows.updateWorkflow` | — | PUT /workflows/{action_id} | external | — | — |
| `workflows.deleteWorkflow` | `delete_workflow_workflows__action_id__delete` | DELETE /workflows/{action_id} | destructive, `workflows:delete` | path | `Record` |

Also available:

- Execution control (all external): `pauseExecution`, `resumeExecution`, `stopExecution`, `restartExecution`, `bulkRestartExecutions`, `approveExecution`, `requestExecutionChanges`, `resetTriggerCursor`.
- `rejectExecution` (write).
- Stats (read): `getExecutionStats`, `getWorkflowRunSummary`, `getTriggerActivity`, `getWorkflowNodeStats`.
- `validateWorkflow` (external), `planWorkflow` (read), `getNodeTypesSchema` (read).

---

## 7. Sequence step edit and change detection

### `g8.api.sequenceLifecycle.updateSequenceStep` — `update_sequence_step_sequences__sequence_id__steps__step_id__patch` — PATCH /api/v1/sequences/{sequence_id}/steps/{step_id} (**external**, `sequences:run`, no blind retry)

- path `{ sequence_id: string; step_id: string }`
- body (required) `StepUpdateRequest`:
  - `step_type?: string | null` (EMAIL | PHONE | SMS | WHATSAPP | HEYREACH | MANUAL_DIALER; case-insensitive)
  - `input_type?: string | null` (ON_DEMAND | MANUAL_TEMPLATE | AI_GENERATED_TEMPLATE)
  - `step_data?: Record<string, unknown> | null`
  - `time_interval?: number | null` (**seconds** after the previous step, per the JSDoc)
- 200 envelope `SequenceActionResponse = { sequence_id: string; status: string; contacts_affected?: number }`
- The response does **not** return the updated step, a new version or `updated_at`.

The sequence-level counterpart is `sequenceLifecycle.updateSequence` (PATCH /sequences/{id}, external). Its body and response are in `docs/endpoints.md` §8. `sequences.deleteSequenceStep` (DELETE /sequences/{sequence_id}/steps/{step_id}) is destructive.

### What exists for a change-detection gate

- `SequenceDetailResponse.updated_at?: string | null` (from `sequences.getSequence`) and `SequenceListItem.updated_at` (from `listSequences`).
  - Whether a step PATCH bumps the sequence's `updated_at` is **not stated** in the types.
- `listSequenceSteps` and `previewSequence` return `PreviewStepItem = { id: string; step_order: number; step_type: string; input_type: string; step_data?: Record<string, unknown> | null; time_interval?: number | null; rendered?: RenderedStepContent | null }`.
  - This has **no `updated_at`, version, revision or hash**.
- There is no sequence history or audit operation. Among the sequence GETs, only stats, reports and analytics are available.
- There is no webhook event for a sequence or step edit (see section 6).
- **Conclusion:** a gate has to fingerprint the steps itself, for example by hashing `step_order`, `step_type`, `input_type`, `step_data` and `time_interval` from `listSequenceSteps`. It can combine that with `getSequence().data.updated_at` as a cheap first check.
- **Deals** do have an optimistic-concurrency token: `DealDetail.revision` together with `DealUpdateRequest.expected_revision`. Tasks have `TaskUpdateRequest.expected_updated_at`.

---

## 8. Contacts across companies by owner

### `g8.api.companies.listContactsAcrossCompanies` — `list_contacts_across_companies_companies_contacts_get` — GET /api/v1/companies/contacts (read, `companies:read`)

- query?:
  - **`owner_id?: string | null`** (contact owner)
  - `skip?: number`, `limit?: number` (the SDK notes the app default is 10000; use 100 here)
  - `search?: string | null` (substring on name or email)
  - `department?: string | null`
  - `buying_role?: string | null` (for example `decision_maker`)
  - `in_pipeline?: boolean` (only contacts attached to an open deal)
  - `sort_by?: string` (name | title | company_name | department | email | updated_at), `sort_order?: string` (asc | desc)
- 200 envelope, `data: CrmCollectionPayload = { items?: Array<unknown>; [key: string]: unknown }`. This is **untyped**.
- `ContactListItem` from `contacts.listContacts` does carry `owner_id?` and `owner_name?`, but `listContacts` has **no `owner_id` filter**.

---

## 9. Credits, usage, API key identity

| call | operationId | route | tier / scope | input | 200 |
|---|---|---|---|---|---|
| `me.describeCurrentKey` | `describe_current_key_me_get` | GET /me | read, **no scope** ("n/a") | none | envelope `Record<string, unknown>` (untyped) |
| `usage.getUsage` | `get_usage_usage_get` | GET /usage | read, `usage:read` | none | envelope `UsageBalanceResponse` |
| `usage.listUsageTransactions` | `list_usage_transactions_usage_transactions_get` | GET /usage/transactions | read, `usage:read` | query `{ page?; limit?; cursor?: string \| null /* page is ignored when a cursor is given */ }` | envelope `UsageTransactionResponse[]` |
| `usage.getCreditHolds` | `get_credit_holds_usage_holds_get` | GET /usage/holds | read, `analytics:read` | none | envelope `ReportPayload` (untyped) |
| `usage.getSubscriptionStatus` | `get_subscription_status_usage_subscription_get` | GET /usage/subscription | read, `analytics:read` | none | envelope `ReportPayload` (untyped) |
| `apiKeys.listApiKeys` | `list_api_keys_api_keys_get` | GET /api-keys | read, `account:read` | none | envelope `{ keys: ApiKeyResponse[] }` |
| `apiKeys.listScopeCatalog` | `list_scope_catalog_api_keys_scopes_get` | GET /api-keys/scopes | read, `account:read` | none | envelope `{ default_scopes: string[]; resources: Array<{ resource: string; scopes: ScopeCatalogEntry[] }> }` |
| `roles.getMyPermissions` | `get_my_permissions_roles_me_permissions_get` | GET /roles/me/permissions | read, `account:read` | none | envelope untyped |
| `teamMembers.getMyTeamMember` | `get_my_team_member_team_members_me_get` | GET /team-members/me | read, `team:read` | query `{ include_preferences?: boolean }` | envelope untyped |
| `agency.getAgencyMe` | `get_agency_me_agency_me_get` | GET /agency/me | read, `account:read` | none | envelope untyped |

- `UsageBalanceResponse = { credits: number /* total balance */; available_credits: number /* credits - held */; held_credits: number; total_earned: number; total_used: number; customer_id: string }`
- `UsageTransactionResponse = { id?: string | null; amount?: number /* negative = spend */; type?: string | null /* 'usage' | 'purchase' ... */; service?: string | null /* e.g. 'ai_enrichment' */; llm_tier?: string | null /* g8_t1|g8_t2|g8_t3 */; quantity?: number | null; description?: string | null; created_at?: string | null }`
- `ApiKeyResponse = { api_key_id: string; name: string; scopes?: string[]; mode?: string; is_agency?: boolean; is_legacy_unrestricted?: boolean /* an empty scope list means UNRESTRICTED */; created_at?: number | null; expires_at?: number | null; last_used_at?: number | null /* epoch numbers, not ISO */; created_by?: string | null }`
- Not relevant to graph8 credits: `providerUsage.*` (third-party provider usage) and `usage.getLlmPricing` / `getDomainPricing` / `listBillingProducts` (pricing catalogs).
- Credit pre-checks exist only for specific features: `enrichment.validateAiEnrichmentCredits`, `validateWaterfallEnrichmentCredits` and `workbench.quote*`.
