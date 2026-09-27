// Primitive workspace operations. graph8.ts implements them for real;
// mock.ts implements them in memory for the automated test suite only.
import type { Deal, NewContact, OwnerRow, SentEmail, Workspace } from "./types";

export interface Backend {
  kind: "graph8" | "mock";
  /** sandbox=false for live keys; writable=false when the key has no write scopes. */
  sandboxStatus(): Promise<{ sandbox: boolean; workspaceId?: string; name?: string; keyMode?: string; writable?: boolean; detail?: unknown }>;
  discover(): Promise<Workspace>;
  sequenceSteps(sequenceId: string): Promise<Workspace["sequences"][number]["steps"]>;

  findContactByEmail(email: string): Promise<string | null>;
  createContact(c: NewContact, customFields?: Record<string, string>): Promise<string>;
  deleteContact(contactId: string): Promise<void>;
  contactsByCustomField(field: string, value?: string): Promise<{ contactId: string; email: string }[]>;

  createList(name: string): Promise<string>;
  deleteList(listId: string): Promise<void>;
  addToList(listId: string, contactIds: string[]): Promise<void>;

  enrol(sequenceId: string, contactIds: string[], listId: string): Promise<void>;
  withdraw(contactIds: string[], sequenceIds?: string[]): Promise<void>;
  contactSequenceIds(contactId: string): Promise<string[]>;
  sequenceContactIds(sequenceId: string): Promise<string[]>;

  suppress(contactId: string): Promise<void>;
  reinstate(contactId: string): Promise<void>;
  isSuppressed(contactId: string): Promise<boolean>;

  outbox(since: string): Promise<SentEmail[]>;
  activeContactOwners(): Promise<OwnerRow[]>;

  sequenceStatus(sequenceId: string): Promise<string>;
  pauseSequence(sequenceId: string): Promise<void>;
  resumeSequence(sequenceId: string): Promise<void>;

  previewReown(contactIds: string[], ownerUserId: string): Promise<{ count: number }>;
  reownViaList(contactIds: string[], ownerUserId: string): Promise<void>;
  /** Undo helper: clear the owner on exactly these contacts (via a temporary list). */
  clearOwnerViaList(contactIds: string[]): Promise<void>;

  createTask(input: { contactId?: string; dealId?: string; title: string; body: string }): Promise<string>;
  deleteTask(taskId: string): Promise<void>;
  addDealNote(dealId: string, body: string): Promise<string>;
  deleteDealNote(dealId: string, noteId: string): Promise<void>;
  dealsForContacts(contactIds: string[]): Promise<Deal[]>;
}
