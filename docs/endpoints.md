# graph8 SDK endpoint reference (crash-test subset)

Source: `@graph8/sdk` v0.245.0, `node_modules/@graph8/sdk/dist/index.d.ts` (`ApiOperationMap`) and `dist/index.js` (runtime).
Everything below is copied from the generated types; nothing was verified against the live API.

Conventions used below:

- Every operation also accepts `headers?: { "X-Target-Org-Id"?: string | null }`. It is omitted from each entry to save space. It only takes effect for agency keys.
- `?` means optional. `| null` means nullable. "Envelope" means the response type is `ApiResponse_X_ = { data: X; pagination?: PaginationMeta | null }`.
- `G8Contract.X` is the exported `schemas` namespace. Some names are re-exported from `$1`-suffixed internal interfaces, for example `G8Contract.SequenceListItem` = `SequenceListItem$1`. The shapes below are the ones the operation types actually reference.
- Call form: `g8.api.<tag>.<member>(input?, options?)` or `g8.api.call("<operationId>", input?, options?)`. `input` becomes optional only when every key in it is optional.

---

## 0. Runtime behaviour (dist/index.js)

### Init / base URL / auth

- Initialize with `g8.init({ apiKey, apiUrl?, writeKey?, host?, debug? })`. `g8.api` is `createApiClient(apiKey, apiUrl)`.
- **Base URL:** `config.apiUrl || "https://be.graph8.com"`. The route table stores paths relative to `/api/v1` (for example `/sandbox/outbox`), and the dispatcher adds `API_BASE_PATH = "/api/v1"`. A trailing slash on `apiUrl` is stripped.
- **Auth header:** `Authorization: Bearer <apiKey>`, plus `Content-Type: application/json`.
- Accessing `g8.api` before `init` throws `Error("g8.init() must be called first")`. Accessing it with no `apiKey` throws `Error("g8.api requires an API key. Use g8.init({ apiKey: '...' })")`. Both are plain `Error`s.
- **Idempotency:** for every POST, PUT, PATCH and DELETE, an `Idempotency-Key` header (a random UUID) is minted automatically unless `maxRetries` is 0. You can override it with `options.idempotencyKey`. The same key is reused across retries.
- **Query encoding:** `URLSearchParams`. `null` and `undefined` values are dropped, and everything else is converted with `String(v)`.
- **Path params:** substituted into `{name}` and URI-encoded. A missing, `null` or `""` path param throws a plain `Error('graph8 operation "<id>" requires the path parameter "<name>".')` before any request is sent. An unknown operationId also throws a plain `Error`.
- **Per-call options** (`ApiCallOptions` = `RequestOptions` minus method, body and query): `headers`, `idempotencyKey`, `maxRetries` (default 2, so up to 3 tries), `retryBaseMs` (default 200), `signal`, `fetchImpl`, `sleepImpl`.

### Success

- The response is `JSON.parse`d and **returned raw**. `g8.api` does **not** unwrap `.data`, so callers read `res.data`. Most operations return the envelope `{ data, pagination? }`. The **sandbox operations are the exception**: they return a bare object with no `data` wrapper (see section 1).
- An empty body returns `undefined`.

### Errors: it throws

Any non-2xx response, after retries are exhausted, throws **`G8Error extends Error`** (`name = "G8Error"`) with these fields:

| field | source |
|---|---|
| `message: string` | `body.message`, then `body.error`, then `"Request failed with status N"` |
| `status: number` | HTTP status (`0` for network errors) |
| `type: string` | `body.type`, then `body.error`, then `"api_error"` (`"network_error"` for network failures) |
| `code?: string` | `body.code` if it is a string, otherwise `String(status)` |
| `requestId?: string` | `body.request_id`, then the `x-request-id` response header |
| `detail?: unknown` | `body.detail` (for example, the FastAPI 422 validation array) |
| `retryable: boolean` | true for 429 and 5xx |

### Retry and rate limiting

- There is no client-side rate limiter or throttle. The client only retries.
- It retries 429 and 5xx responses, and network errors thrown by `fetch`. The delay is the `Retry-After` value (seconds or HTTP-date) when present. Otherwise it is exponential backoff with full jitter: `min(base*2^attempt, 10s)`, halved, plus a random part.
- **"No-blind-retry" operations** are the billable routes plus the `EXTERNAL_ROUTES` table. They retry only on 429 and on network errors that provably happened before sending (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`, `UND_ERR_CONNECT_TIMEOUT`). They are never retried on 5xx. The operations below that fall in this group are: `POST /sequences`, `POST /sequences/{id}/contacts`, `POST /sequences/{id}/pause`, `POST /sequences/{id}/resume`, `PATCH /sequences/{id}` and `PATCH /sequences/{id}/steps/{step_id}` (plus `/run` and `/sync`).
- A 4xx other than 429 is thrown immediately.

### Pagination

- `PaginationMeta` (the one used by the envelopes, `PaginationMeta$1`):
  ```ts
  { page: number; limit: number; total: number; has_next: boolean; next_cursor?: string | null }
  ```
- The list operations below take `page` and `limit` query params (page is 1-indexed). The query types do **not** declare a `cursor` param.
- `g8.api.paginate(operationId, input)` follows `pagination.next_cursor`, sends it back as `query.cursor`, and yields each item of `data[]`. It stops when `next_cursor` is falsy. If the server does not return `next_cursor`, it yields only the first page.
- Sandbox outbox and suppressions use `limit` and `offset` instead of `page`.

### ID types (as typed)

| entity | type |
|---|---|
| sequence id, step id | `string` |
| contact id, list id (`list_id` / `audience_id`), company id, mailbox id | `number` |
| task id, suppression record id | `string` |
| owner / user ids (`owner_id`, `owner_user_id`, `assignee_id`) | `string` |

---

## 1. Sandbox (tag `sandbox`)

These responses are **not** enveloped: there is no `data` key.

### `g8.api.sandbox.sandboxOutbox` — `sandbox_outbox_sandbox_outbox_get` — GET /api/v1/sandbox/outbox (read, `sandbox:read`)

- query?: `{ channel?: string | null /* Filter by channel */; limit?: number; offset?: number }`
- 200 `OutboxListResponse`: `{ count: number; items: Array<Record<string, unknown>>; sandbox?: boolean }`
- The type does not declare item fields. The only filter is `channel`; there is no filter by contact, sequence or time.

### `g8.api.sandbox.sandboxStatus` — `sandbox_status_sandbox_status_get` — GET /api/v1/sandbox/status (read)

- no path, query or body
- 200 `SandboxStatusResponse`: `{ environment?: string; message: string; org_id: string; sandbox?: boolean }`

### `g8.api.sandbox.sandboxSnapshot` — `sandbox_snapshot_sandbox_fixtures_snapshot_post` — POST /api/v1/sandbox/fixtures/snapshot (write)

- query?: `{ name?: string }`
- 200 `SnapshotActionResponse`: `{ action: string; name: string; sandbox?: boolean; tables: Array<string> }`

### `g8.api.sandbox.sandboxRestore` — `sandbox_restore_sandbox_fixtures_restore_post` — POST /api/v1/sandbox/fixtures/restore (destructive, `sandbox:delete`)

- query?: `{ name?: string }`
- 200 `SnapshotActionResponse` (same shape as above)

### `g8.api.sandbox.sandboxSeedFixtures` — `sandbox_seed_fixtures_sandbox_fixtures_seed_post` — POST /api/v1/sandbox/fixtures/seed (write)

- no path, query or body
- 200 `FixtureActionResponse`: `{ action: string; companies?: number; contacts?: number; detail?: string | null; sandbox?: boolean }`

### `g8.api.sandbox.sandboxSetFailureRule` — `sandbox_set_failure_rule_sandbox_failure_injection_put` — PUT /api/v1/sandbox/failure-injection (write)

- body (required) `FailureRuleRequest`:
  - `channel: string`. One of email, sms, whatsapp, voice, linkedin, crm, ads, calendar, or `'*'` for every channel.
  - `failure_mode: string`. One of hard_bounce, provider_error, timeout, rate_limited, invalid_recipient.
  - `remaining?: number | null`. Fail this many sends, then auto-clear. Omit it to fail until cleared.
- 200 `FailureRulesResponse`: `{ rules: Array<Record<string, unknown>>; sandbox?: boolean }`

Related sandbox operations not in the requested list:

| call | operationId | route | input | 200 |
|---|---|---|---|---|
| `sandbox.sandboxListFailureRules` | `sandbox_list_failure_rules_sandbox_failure_injection_get` | GET /sandbox/failure-injection | none | `FailureRulesResponse` |
| `sandbox.sandboxClearFailureRules` | `sandbox_clear_failure_rules_sandbox_failure_injection_delete` | DELETE /sandbox/failure-injection | query `channel?: string \| null` (omit to clear all channels) | `FailureRulesResponse` |
| `sandbox.sandboxResetFixtures` | `sandbox_reset_fixtures_sandbox_fixtures_reset_post` | POST /sandbox/fixtures/reset (destructive) | none | `FixtureActionResponse` |

---

## 2. Sequences

Shared shapes:

- `SequenceActionResponse = { contacts_affected?: number; sequence_id: string; status: string }`
- `PreviewStepItem = { id: string; input_type: string; rendered?: RenderedStepContent | null; step_data?: Record<string, unknown> | null; step_order: number; step_type: string; time_interval?: number | null }`
- `RenderedStepContent = { body: string; subject: string; spintax_blocks: number; content_issues?: Array<Record<string, unknown>>; ... }`

### `g8.api.sequences.listSequences` — `list_sequences_sequences_get` — GET /api/v1/sequences (read)

- query?: `{ page?: number; limit?: number; status?: string | null; sequence_kind?: string | null /* 'cold_outbound' | 'nurture' */ }`
- 200 envelope, `data: Array<SequenceListItem>`:
  `{ id: string; name?: string | null; status?: string | null; user_email?: string | null; step_count?: number | null; contact_count?: number | null; sequence_kind?: string | null; associated_list_id?: number | null; created_at?: string | null; updated_at?: string | null }`

### `g8.api.sequences.getSequence` — `get_sequence_sequences__sequence_id__get` — GET /api/v1/sequences/{sequence_id} (read)

- path: `{ sequence_id: string }`
- 200 envelope, `data: SequenceDetailResponse`:
  `{ id: string; name?: string | null; status?: string | null; description?: string | null; sequence_kind?: string | null; associated_list_id?: number | null; appointment_id?: number | null; pinned_mailbox_id?: number | null; schedule_id?: string | null; finish_on_reply?: boolean; send_in_same_thread?: boolean; wait_for_new_contacts?: boolean; paused_at?: string | null; resumed_at?: string | null; textual_agent_name?: string | null; voice_agent_name?: string | null; user_email?: string | null; created_at?: string | null; updated_at?: string | null }`

### `g8.api.sequenceLifecycle.listSequenceSteps` — `list_sequence_steps_sequences__sequence_id__steps_get` — GET /api/v1/sequences/{sequence_id}/steps (read)

- path: `{ sequence_id: string }`
- 200 envelope, `data: SequenceStepsResponse = { sequence_id: string; steps?: Array<PreviewStepItem> }`

### `g8.api.sequences.addContactsToSequence` — `add_contacts_to_sequence_sequences__sequence_id__contacts_post` — POST /api/v1/sequences/{sequence_id}/contacts (external, `sequences:run`, no blind retry)

- path: `{ sequence_id: string }`
- body (required) `AddSequenceContactsRequest`:
  - `contact_ids: Array<number>` (contact IDs to add to the sequence)
  - `list_id: number` (**required**: the list ID the contacts belong to)
- 200 envelope, `data: SequenceActionResponse`

### `g8.api.sequences.listSequenceContacts` — `list_sequence_contacts_sequences__sequence_id__contacts_get` — GET /api/v1/sequences/{sequence_id}/contacts (read)

- path: `{ sequence_id: string }`
- query?: `{ page?: number; limit?: number; state?: string | null }`
- 200 envelope, `data: Array<SequenceContactItem>`:
  `{ id?: string | null; contact_id?: number | null; state?: string | null; current_step_order?: number | null; created_at?: string | null; updated_at?: string | null }`

### `g8.api.sequences.listSequenceContactIds` — `list_sequence_contact_ids_sequences__sequence_id__contact_ids_get` — GET /api/v1/sequences/{sequence_id}/contact-ids (read)

- path: `{ sequence_id: string }`
- query?:
  - `search?: string | null` (free text over name, email and phone)
  - `state_filter?: string | null` (comma-separated states to include)
  - `exclude_states?: string | null` (comma-separated states to exclude)
  - `mailbox_filter?: string | null`
  - `phone_allocated_filter?: string | null`
  - `company_filter?: string | null`
  - `step_order_filter?: number | null`
- 200 envelope, `data: SequencerPayload = Record<string, unknown>` (untyped)

### `g8.api.sequences.pauseSequence` — `pause_sequence_sequences__sequence_id__pause_post` — POST /api/v1/sequences/{sequence_id}/pause (external, no blind retry)

- path: `{ sequence_id: string }`; no body
- 200 envelope, `data: SequenceActionResponse`

### `g8.api.sequences.resumeSequence` — `resume_sequence_sequences__sequence_id__resume_post` — POST /api/v1/sequences/{sequence_id}/resume (external, no blind retry)

- path: `{ sequence_id: string }`; no body
- 200 envelope, `data: SequenceActionResponse`

### `g8.api.sequences.setSequenceStatus` — `set_sequence_status_sequences__sequence_id__status_post` — POST /api/v1/sequences/{sequence_id}/status (write)

- path: `{ sequence_id: string }`
- body (required) `SequenceStatusRequest`: `{ status: string }`
  - Documented values: drafted, scheduling, live, pausing, paused, resuming, terminating, terminated, completed, waiting.
  - The type is an open string. An unknown value returns a 422 that lists the valid set.
- 200 envelope, `data: SequenceRecord`:
  `{ id?: string | null; name?: string | null; status?: string | null; sequence_kind?: string | null; associated_list_id?: number | null; campaign_builder_campaign_id?: string | null; is_archived?: boolean | null; is_shared?: boolean | null; user_email?: string | null; created_at?: string | null; updated_at?: string | null; [key: string]: unknown }`

### `g8.api.sequenceLifecycle.createSequence` — `create_sequence_sequences_post` — POST /api/v1/sequences (external, no blind retry)

- body (required) `SequenceCreateRequest`:
  - `name: string` (required)
  - `user_email: string` (required; owner email)
  - `associated_list_id?: number | null` (contact list to associate)
  - `campaign_id?: string | null`
  - `channels?: Array<ChannelConfig> | null`
  - `steps?: Array<StepConfig> | null`
  - `description?: string | null`
  - `finish_on_reply?: boolean`
  - `send_in_same_thread?: boolean`
  - `wait_for_new_contacts?: boolean` (keep the sequence waiting for new contacts)
  - `sequence_kind?: string | null`: `'cold_outbound'` (default) or `'nurture'`. It cannot be changed after creation. `'nurture'` requires `pinned_mailbox_id` and is gated by the ENABLE_NURTURE flag.
  - `pinned_mailbox_id?: number | null`
- `ChannelConfig`:
  `{ channel_id: number; channel_type: string /* SMTP | GMAIL | INBOXKIT | PHONE | LINKEDIN | SMS | WHATSAPP, case-insensitive */; channel_value: string; channel_data?: Record<string, unknown> | null }`
- `StepConfig`:
  - `step_order: number` (1-based)
  - `step_type: string`: EMAIL, PHONE, SMS, WHATSAPP, HEYREACH or MANUAL_DIALER. LinkedIn uses HEYREACH. Case-insensitive aliases are accepted.
  - `input_type?: string`: ON_DEMAND, MANUAL_TEMPLATE or AI_GENERATED_TEMPLATE. Aliases such as `'template'` and `'ai'` are accepted.
  - `step_data?: Record<string, unknown> | null`
  - `time_interval?: number` (seconds after the previous step)
- 200 envelope, `data: SequenceCreateResponse = { id: string; name: string; status: string; created_at?: string | null }`

### `g8.api.sequences.addSequenceSteps` — `add_sequence_steps_sequences__sequence_id__steps_post` — POST /api/v1/sequences/{sequence_id}/steps (write)

- path: `{ sequence_id: string }`
- body (required) `AddStepsRequest = { steps: Array<AddStepItem> }`
- `AddStepItem` (strict enums here, unlike `StepConfig`):
  - `step_order: number` (1-based)
  - `step_type: "PHONE" | "EMAIL" | "MANUAL_DIALER" | "HEYREACH" | "NETRION" | "SMS" | "WHATSAPP"`
  - `input_type: "ON_DEMAND" | "AI_GENERATED_TEMPLATE" | "MANUAL_TEMPLATE"` (required)
  - `step_data: Record<string, unknown>` (required). Use `subject` and `body` for email, `message_body` for SMS and WhatsApp, `linkedin_*` for LinkedIn, and `instructions` for AI.
  - `time_interval?: number | null`
- 200 envelope, `data: SequencerListPayload = { items?: Array<unknown>; [key: string]: unknown }`

### `g8.api.sequenceLifecycle.updateSequenceStep` — `update_sequence_step_sequences__sequence_id__steps__step_id__patch` — PATCH /api/v1/sequences/{sequence_id}/steps/{step_id} (external, no blind retry)

- path: `{ sequence_id: string; step_id: string }`
- body (required) `StepUpdateRequest`: `{ input_type?: string | null; step_type?: string | null; step_data?: Record<string, unknown> | null; time_interval?: number | null }`
- 200 envelope, `data: SequenceActionResponse`

---

## 3. Contacts

### `g8.api.contacts.createContacts` — `create_contacts_contacts_post` — POST /api/v1/contacts (write)

- headers?: `{ "Idempotency-Key"?: string | null }`. A retry with the same key returns the first response (cached 24h). The SDK auto-mints one anyway.
- body (required) `ContactCreateRequest` is a **single contact, not an array**. Every field is optional:
  - `first_name`, `last_name`, `work_email`, `personal_emails`, `job_title`, `job_department`, `seniority_level`, `direct_phone`, `mobile_phone`, `linkedin_url`, `city`, `state`, `country`, `company_domain`: all `?: string | null`
  - `company_id?: number | null`
  - `list_id?: number | null` (the contact is added to this list after creation)
  - `custom_fields?: Record<string, string | null> | null` (keys are a column title, slug, or case/space variant)
  - `create_missing_fields?: boolean`
- 200 envelope, `data: ContactCreateResponse`:
  `{ status: string; count: number; contact_id?: number | null; merged?: boolean; company_attached?: boolean; validation_errors?: Array<string>; custom_fields?: { created?: string[]; ignored?: string[]; written?: string[] } }`

### `g8.api.contacts.getContact` — `get_contact_contacts__contact_id__get` — GET /api/v1/contacts/{contact_id} (read)

- path: `{ contact_id: number }`
- query?: `{ include_custom_fields?: boolean }`
- 200 envelope, `data: ContactResponse`:
  - `id: number`
  - Everything else is `?` and nullable: `first_name`, `last_name`, `full_name`, `work_email`, `personal_emails` (unknown), `job_title`, `job_department`, `seniority_level`, `direct_phone`, `mobile_phone`, `linkedin_url`, `facebook_url`, `twitter_url`, `city`, `state`, `country`, `about`, `confidence_score` (number), `meta_data` (Record), `custom_fields` (Record<string, string | null>), `created_at`, `updated_at`, `company` (`ContactCompanySummary`)
  - `ContactCompanySummary = { id?: number | null; name?; domain?; website?; industry?; employee_count?: string | null; city?; state?; country?; linkedin_url?; logo_url? }`. The unannotated fields are `string | null`.

### `g8.api.contacts.listContacts` — `list_contacts_contacts_get` — GET /api/v1/contacts (read)

- query? (all optional, and all nullable except `page`, `limit` and `include_custom_fields`):
  - `page?: number`
  - `limit?: number` (max 200)
  - `email?: string` (exact match on work email)
  - `list_id?: number`
  - `name?: string` (partial match)
  - `job_title?: string`
  - `seniority_level?: string`
  - `company_name?: string`
  - `company_id?: number`
  - `country?`, `state?`, `city?`, `job_department?`, `industry?: string`
  - `include_custom_fields?: boolean`
- 200 envelope, `data: Array<ContactListItem>`:
  - `id?: number | null` (note: optional and nullable here)
  - `first_name`, `last_name`, `work_email`, `job_title`, `job_department`, `seniority_level`, `direct_phone`, `mobile_phone`, `linkedin_url`, `city`, `state`, `country`: `?: string | null`
  - `company_id?: number | null`
  - `owner_id?: string | null`, `owner_name?: string | null`
  - `custom_fields?: Record<string, string | null> | null`

### `g8.api.contacts.updateContact` — `update_contact_contacts__contact_id__patch` — PATCH /api/v1/contacts/{contact_id} (write)

- path: `{ contact_id: number }`
- body (required) `ContactUpdateRequest`, all `?: string | null` except `company_id?: number | null`: `first_name`, `last_name`, `work_email`, `job_title`, `job_department`, `seniority_level`, `direct_phone`, `mobile_phone`, `linkedin_url`, `city`, `state`, `country`, `company_domain`, `company_id`
- 200 envelope, `data: Record<string, unknown>`

### `g8.api.contacts.deleteContact` — `delete_contact_contacts__contact_id__delete` — DELETE /api/v1/contacts/{contact_id} (destructive, `contacts:delete`)

- path: `{ contact_id: number }`
- 200 envelope, `data: Record<string, unknown>`

### `g8.api.contacts.getContactSequences` — `get_contact_sequences_contacts__contact_id__sequences_get` — GET /api/v1/contacts/{contact_id}/sequences (read)

- path: `{ contact_id: number }`
- 200 envelope, `data: CrmCollectionPayload = { items?: Array<unknown>; [key: string]: unknown }` (the item shape is untyped)

### `g8.api.contacts.withdrawContactsFromSequences` — `withdraw_contacts_from_sequences_contacts_withdraw_from_sequences_post` — POST /api/v1/contacts/withdraw-from-sequences (write)

- body (required) `WithdrawFromSequencesRequest`:
  - `contact_ids?: Array<number>` (max 5000)
  - `sequence_id?: string | null` (required unless `remove_all` is true)
  - `remove_all?: boolean` (withdraw from every sequence; ignores `sequence_id`)
  - `target_state?: string | null` (`removed` | `completed` | `not_interested`)
  - `source?: string | null`
- 200 envelope, `data: CrmRecordPayload = Record<string, unknown>`

### `g8.api.contacts.assignContactOwner` — `assign_contact_owner_contacts_assign_owner_post` — POST /api/v1/contacts/assign-owner (write)

- body (required) `AssignOwnerMatchingRequest`:
  - `owner_id?: string | null` (null clears the owner on every match)
  - `list_id?: number | null`
  - `filterModel?: Record<string, unknown>` (per-column filters)
  - `segmentFilter?: SegmentFilterGroup | null`
- `SegmentFilterGroup = { op: "AND" | "OR" | "and" | "or"; children?: Array<SegmentFilterSubgroup | SegmentFilterLeaf> }`
- `SegmentFilterLeaf`:
  - `field: string` (for example `CONTACT_JOB_TITLE`)
  - `op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "contains" | "icontains" | "starts_with" | "ends_with" | "in" | "not_in" | "between" | "is_null" | "is_not_null"`
  - `value?: unknown`
  - `valueTo?: unknown`
- The body does **not** take `contact_ids`. It selects contacts by list and filters.
- 200 envelope, `data: Record<string, unknown>`

---

## 4. Suppressions (tag `suppressions`)

`SuppressionRecord`:
`{ id: string; contact_id: number; channel: string /* all|email|phone|linkedin */; category: string /* contact_initiated|org_initiated|system */; reason?: string | null; source?: string | null; source_ref?: string | null; created_by?: string | null; created_at?: string | null; revision?: number | null }`

### `g8.api.suppressions.bulkAddSuppressions` — `bulk_add_suppressions_contacts_suppressions_bulk_add_post` — POST /api/v1/contacts/suppressions/bulk-add (write)

- body (required): `{ contact_ids: Array<number>; channel?: "all" | "email" | "phone" | "linkedin"; reason?: string | null }`
- 200 envelope, `data: BulkSuppressResponse = { channel: string; suppressed: number; total_requested: number }`

### `g8.api.suppressions.reinstateSuppressions` — `reinstate_suppressions_contacts_suppressions_reinstate_post` — POST /api/v1/contacts/suppressions/reinstate (write)

- body (required): `{ contact_ids: Array<number>; reason?: string | null }`
- 200 envelope, `data: BulkReinstateResponse = { total_requested: number; reinstated?: Array<number>; skipped?: Array<{ contact_id: number; reason: string }> }`

### `g8.api.suppressions.checkContactSuppression` — `check_contact_suppression_contacts__contact_id__suppression_get` — GET /api/v1/contacts/{contact_id}/suppression (read)

- path: `{ contact_id: number }`
- 200 envelope, `data: SuppressionStatusResponse = { contact_id: number; is_suppressed: boolean; active_channels?: Array<string>; suppressions?: Array<SuppressionRecord> }`

### `g8.api.suppressions.listSuppressions` — `list_suppressions_contacts_suppressions_get` — GET /api/v1/contacts/suppressions (read)

- query?:
  - `channel?: "all" | "email" | "phone" | "linkedin" | null`
  - `category?: "contact_initiated" | "org_initiated" | "system" | null`
  - `limit?: number`
  - `offset?: number`
- 200 envelope, `data: Array<SuppressionRecord>`

### `g8.api.suppressions.suppressContact` — `suppress_contact_contacts__contact_id__suppress_post` — POST /api/v1/contacts/{contact_id}/suppress (write)

- path: `{ contact_id: number }`
- body? (optional): `{ reason?: string | null }`. It has no channel field.
- 200 envelope, `data: SuppressActionResponse = { contact_id: number; is_suppressed: boolean; revision: number }`

---

## 5. Lists (tag `lists`)

### `g8.api.lists.createList` — `create_list_lists_post` — POST /api/v1/lists (write)

- body (required): `{ title: string; type?: string /* contacts|companies|suppressions|deals|leads */; description?: string | null }`
- 200 envelope, `data: ListCreateResponse = { id: number; title: string; type?: string | null; status?: string | null; total?: number; description?: string | null }`

### `g8.api.lists.addContactsToList` — `add_contacts_to_list_lists__list_id__contacts_post` — POST /api/v1/lists/{list_id}/contacts (write)

- path: `{ list_id: number }`
- body (required) `AddContactsToListRequest`:
  - `contact_ids: Array<number>`
  - `conflict_resolution?: "add_all" | "skip_all" | "custom" | null`
  - `include_warned_ids?: Array<string> | null` (note: typed as **string** ids)
- `conflict_resolution` is required when retrying after a **409 `CONFLICT_REVIEW_REQUIRED`**:
  - `add_all` adds ready contacts plus every warned contact.
  - `skip_all` adds only ready contacts.
  - `custom` adds ready contacts plus `include_warned_ids`.
  - Blocked contacts are always excluded.
- 200 envelope, `data: Record<string, unknown>`

### `g8.api.lists.getListContacts` — `get_list_contacts_lists__list_id__contacts_get` — GET /api/v1/lists/{list_id}/contacts (read)

- path: `{ list_id: number }`
- query?: `{ page?: number; limit?: number /* max 200 */ }`
- 200 envelope, `data: Array<ContactListItem>` (same shape as `listContacts`)

### `g8.api.lists.deleteList` — `delete_list_lists__list_id__delete` — DELETE /api/v1/lists/{list_id} (destructive, `lists:delete`)

- path: `{ list_id: number }`
- 200 envelope, `data: Record<string, unknown>`

### `g8.api.lists.previewListOwnerTransfer` — `preview_list_owner_transfer_lists__audience_id__owner_preview_get` — GET /api/v1/lists/{audience_id}/owner/preview (read)

- path: `{ audience_id: number }`
- query (**required**): `{ new_owner_user_id: string }` (PropelAuth user id)
- 200 envelope, `data: ListPayload = Record<string, unknown>`

### `g8.api.lists.reassignListOwner` — `reassign_list_owner_lists__audience_id__owner_patch` — PATCH /api/v1/lists/{audience_id}/owner (write)

- path: `{ audience_id: number }`
- body (required):
  - `owner_user_id: string`
  - `owner_email: string` (must agree with the user id)
  - `mode?: "list_only" | "list_and_records"`
- 200 envelope, `data: Record<string, unknown>`

### `g8.api.lists.listLists` — `list_lists_lists_get` — GET /api/v1/lists (read)

- query?: `{ page?: number; limit?: number /* max 200 */ }`. There is no name or type filter.
- 200 envelope, `data: Array<ListResponse>`:
  `{ id: number; title: string; type?: string | null; status?: string | null; total?: number; is_dynamic?: boolean; source?: string | null; tags?: Array<string>; description?: string | null; created_by?: string | null; created_at?: string | null; updated_at?: string | null }`

---

## 6. Tasks (tag `tasks`)

`TaskCreateRequest` (body for both operations):

- `title: string` (required)
- `description?: string | null`
- `assignee_id?: string | null`
- `due_date?: string | null` (ISO 8601)
- `priority?: number | null` (0 = none, 1 = high, 2 = medium, 3 = low)
- `task_type?: string | null` (for example call or meeting)
- `tags?: Array<string> | null`
- `entity_id?: string | null`, `entity_type?: string | null`
- `records?: Array<Record<string, string>> | null` (related contact, company, deal, lead, application, team_member or campaign)
- `parent_task_id?: string | null`, `subtask_sort_order?: number | null`
- `source_url?: string | null`

`TaskResponse`:

- Required: `id: string`, `title: string`
- Optional: `status?`, `priority?: number | null`, `task_type?`, `assignee_id?`, `assignee_name?`, `due_date?`, `description?`, `entity_id?`, `entity_type?`, `entity_label?`, `executor_type?: "human" | "agent"`, `executor_agent_id?`, `executor_agent_name?`, `execution_id?`, `links?: Array<Record<string, unknown>>`, `tags?: string[]`, `parent_task_id?`, `subtask_count?`, `completed_subtask_count?`, `subtask_sort_order?`, `reminder_at?`, `reminder_sent_at?`, `source_*` fields, `visibility?`, `created_by?`, `created_at?`, `updated_at?`

### `g8.api.tasks.createTask` — `create_task_contacts__contact_id__tasks_post` — POST /api/v1/contacts/{contact_id}/tasks (write)

- path: `{ contact_id: number }`
- body (required) `TaskCreateRequest`
- 200 envelope, `data: TaskResponse`

### `g8.api.tasks.createGlobalTask` — `create_global_task_tasks_post` — POST /api/v1/tasks (write)

- headers?: `{ "idempotency-key"?: string | null }`
- body (required) `TaskCreateRequest`
- 200 envelope, `data: TaskResponse`

---

## 7. Users and mailboxes

### `g8.api.roles.listOrgUsers` — `list_org_users_roles_org_users_get` — GET /api/v1/roles/org-users (read, `account:read`)

- no input
- 200 envelope, `data: OrgListPayload = { items?: Array<unknown>; [key: string]: unknown }` (the user shape is untyped)

### `g8.api.mailboxes.listMyMailboxes` — `list_my_mailboxes_mailboxes_my_get` — GET /api/v1/mailboxes/my (read, `campaigns:read`)

- query?: `{ include_archived?: boolean }`
- 200 envelope, `data: MyMailboxesResponse = { mailboxes?: Array<MailboxSummary>; total?: number; [key: string]: unknown }`
- `MailboxSummary = { id?: number | null; email?: string | null; channel_type?: string | null /* SMTP|GMAIL|INBOXKIT */; status?: string | null; is_archived?: boolean | null; [key: string]: unknown }`

---

## 8. List → sequence enrollment configuration ("enrollment gap")

There is **no** dedicated list-trigger or auto-enroll operation for sequences in ops.json. The typed levers are:

- `SequenceCreateRequest.associated_list_id?: number | null` and `wait_for_new_contacts?: boolean`. These are set at create time and come back on `getSequence` and `listSequences` as `associated_list_id` and `wait_for_new_contacts`.
- `g8.api.sequenceLifecycle.updateSequence` — `update_sequence_sequences__sequence_id__patch` — PATCH /sequences/{sequence_id} (external).
  - body `SequenceUpdateRequest`: `wait_for_new_contacts?`, `name?`, `description?`, `finish_on_reply?`, `send_in_same_thread?`, `is_shared?`, `schedule_id?`, `appointment_id?`, `textual_agent_name?`, `voice_agent_name?`
  - It has **no `associated_list_id`**, so the list cannot be changed after creation through this operation.
  - 200 returns `SequenceActionResponse`.
- `g8.api.sequences.syncSequence` — `sync_sequence_sequences__sequence_id__sync_post` — POST /sequences/{sequence_id}/sync (external). Path `sequence_id: string`. 200 returns `data: Record<string, unknown>`. The type does not describe what it syncs.
- `g8.api.sequences.runSequence` — `run_sequence_sequences__sequence_id__run_post` — POST /sequences/{sequence_id}/run (external). 200 returns `SequenceActionResponse`.
- `addContactsToSequence` itself requires `list_id: number` alongside `contact_ids`.

Nearby but unrelated to sequences: `newsletter.enableNewsletterListSync`, `newsletter.listNewsletterListSyncs`, `newsletter.runNewsletterListSync`, `visitors.startCampaignListSync`, `workbench.*Trigger`, `surveys.*Trigger`, `mailboxes.getMailboxAssociatedSequences`.

## 9. Existing test / simulate / preview / validate / health / collision-style operations (brief)

**Sequence and list related:**

- `sequenceLifecycle.previewSequence` (GET /sequences/{id}/preview): returns `data: { id; name?; status?; description?; channels?: PreviewChannelItem[]; steps?: PreviewStepItem[] }`
- `sequences.getSequenceRoutingSummary` (GET /sequences/{id}/routing-summary): returns `{ google_count?, m365_count?, other_count?, bounce_suppressed_count?, personal_suppressed_count?, seg_suppressed_count?, scanned_count? }`
- `sequences.getSequenceStats`, `sequences.getSequenceReports`, `sequenceLifecycle.getSequenceAnalytics` (all GET)
- `deliverability.getSequencesHealth` (GET /deliverability/sequences-health)
- `lists.checkListIntegrity` (POST /lists/{list_id}/integrity-check, read): body `{ extra_fields?: string[] | null }`, returns an untyped Record
- `sequences.placeVoiceTestCall` (POST /sequencer/content/voice/test-call, external)

**Sandbox:** `sandbox.*`. The full set is status, outbox, fixtures seed/reset/snapshot/restore, and failure-injection get/put/delete.

**Collision / duplicates:**

- `duplicates.listDuplicates`, `duplicates.duplicateCounts`
- `contacts.previewContactMerge` (GET /contacts/{id}/merge/preview)
- `contacts.previewDetectionRule`, `contacts.runDuplicateDetection`, `contacts.listDuplicateDetectionRuns`, `contacts.getDuplicateSettings` / `updateDuplicateSettings`
- `contacts.triggerAutoMerge` (destructive), `duplicates.startBulkMerge`, `duplicates.undoMerge`, `duplicates.rejectSuggestion`
- `lists.addContactsToList` returns 409 `CONFLICT_REVIEW_REQUIRED` for warned contacts (see section 5).

**Health:** `mailboxes.getMailboxHealth`, `mailboxes.getFleetHealth`, `agency.getAccountHealth`, `agents.getAgentOperatorHealth`, `integrations.listAdAccountHealth`, `visitors.checkTrackingInstallation`.

**Validate / test (other areas):** `workflows.validateWorkflow`, `skills.validateTemplate`, `apps.validateAppManifest`, `enrichment.validateFormula`, `aiInbox.validateInboxSendMailbox`, `mailboxes.testMailboxConnection`, `forms.testFormRoute`, `workflows.testSkillOnce`, `voice.runAgentTest`, `newsletter.sendTestEmail` (external), `mailboxes.createPlacementTest` (billable).
