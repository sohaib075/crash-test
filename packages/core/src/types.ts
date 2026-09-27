// Internal model of a graph8 workspace, produced by discover().
export type SeqStep = { id: string; order: number; type: string; delayMinutes: number; subject?: string; body?: string };

export type Sequence = {
  id: string; // graph8 id
  name: string;
  status: string;
  steps: SeqStep[];
  mailboxIds: string[];
  senderEmails: string[];
  ownerEmail: string;
  sourceListIds: string[];
  associatedListId: string | null;
  priority: number; // 1 = highest
  contactCount: number | null;
  raw: Record<string, unknown>;
};

/** id is the PropelAuth user id when graph8 returns one (what owner_id and list re-owning use); aliases holds every id variant. */
export type OrgUser = { id: string; email: string; name: string; active: boolean; aliases?: string[] };
export type Mailbox = { id: string; email: string; ownerUserId?: string };
export type ListInfo = { id: string; name: string; size: number };

export type Deal = {
  id: string;
  name: string;
  amount: number | null;
  currency: string;
  stage: string;
  open: boolean;
  ownerId: string | null;
  contactIds: string[];
};

export type Quote = {
  id: string;
  number: string;
  status: string;
  total: number | null;
  currency: string;
  lineItemCount: number | null;
  expiresAt: string | null;
  sentAt: string | null;
  dealId: string | null;
  senderEmail: string | null;
  senderUserId: string | null;
  recipientContactId: string | null;
  recipientEmail: string | null;
  raw: Record<string, unknown>;
};

export type BookingLink = { id: string; name: string; slug: string; hostUserIds: string[]; hostEmails: string[]; raw: Record<string, unknown> };

export type Workspace = {
  graph8Id: string;
  name: string;
  sandbox: boolean;
  fetchedAt: string;
  sequences: Sequence[];
  lists: ListInfo[];
  users: OrgUser[];
  mailboxes: Mailbox[];
  deals: Deal[];
  quotes: Quote[];
  bookingLinks: BookingLink[];
  suppressionCount: number;
};

export type SentEmail = {
  outboxId: string;
  to: string;
  from: string;
  subject: string;
  sentAt: string;
  body: string;
  raw: Record<string, unknown>;
};

export type OwnerRow = { contactId: string; email: string; ownerId: string | null; name?: string };

export type NewContact = { email: string; firstName: string; lastName: string; company: string; title: string };
