"use client";

import type { EvidenceDTO } from "@crash/shared";
import { CalendarClock, FileText, Mail, UserRound } from "lucide-react";
import { highlightParts, money } from "@/lib/format";

function Marked({ text, needle }: { text: string; needle?: string | null }) {
  return (
    <>
      {highlightParts(text, needle).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.t}</mark> : <span key={i}>{p.t}</span>))}
    </>
  );
}

export function EmailEvidence({ e, compact }: { e: EvidenceDTO; compact?: boolean }) {
  const f = e.fields as { to?: string; from?: string };
  return (
    <article className="overflow-hidden rounded-xl border border-line-2 bg-lab">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-xs text-muted">
        <Mail className="h-3.5 w-3.5" />
        <span className="truncate">
          <span className="text-faint">To </span><span className="text-ink">{f.to}</span>
          <span className="text-faint"> · From </span><span className="text-ink">{f.from || "?"}</span>
        </span>
        <span className="ml-auto shrink-0 font-mono text-faint">{new Date(e.at).toLocaleTimeString()}</span>
      </div>
      <div className="px-3.5 py-3">
        <div className="font-medium"><Marked text={e.title} needle={e.highlight} /></div>
        <p className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted ${compact ? "line-clamp-5" : ""}`}>
          <Marked text={e.excerpt ?? ""} needle={e.highlight} />
        </p>
      </div>
      <div className="border-t border-line px-3.5 py-1.5 font-mono text-[11px] text-faint">sandbox outbox · {e.graph8Id}</div>
    </article>
  );
}

export function SequenceEvidence({ e, compact }: { e: EvidenceDTO; compact?: boolean }) {
  const f = e.fields as { issue?: string; sequence?: string };
  return (
    <article className="overflow-hidden rounded-xl border border-line-2 bg-lab">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-xs text-muted">
        <FileText className="h-3.5 w-3.5" /> {f.sequence} · <span className="text-ink">{e.title}</span>
      </div>
      <div className="px-3.5 py-3">
        <p className="text-sm text-fail">{f.issue}</p>
        <p className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted ${compact ? "line-clamp-5" : ""}`}>
          <Marked text={e.excerpt ?? ""} needle={e.highlight} />
        </p>
      </div>
    </article>
  );
}

export function QuoteEvidence({ e }: { e: EvidenceDTO }) {
  const f = e.fields as { quoteTotal?: number | null; dealAmount?: number | null; deal?: string; lineItems?: number | null; expiresAt?: string | null; sender?: string; recipient?: string; status?: string };
  const mismatch = f.quoteTotal != null && f.dealAmount != null && Math.abs(f.quoteTotal - f.dealAmount) / (f.dealAmount || 1) > 0.01;
  return (
    <article className="overflow-hidden rounded-xl border border-line-2 bg-lab">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-xs text-muted">
        <FileText className="h-3.5 w-3.5" /> {e.title} · {f.status} · <span className="ml-auto font-mono">{e.graph8Id.slice(0, 8)}</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-line">
        <div className="px-4 py-3">
          <div className="label">Quote total</div>
          <div className={`mt-1 font-mono text-2xl font-semibold ${mismatch ? "text-fail" : ""}`}>{money(f.quoteTotal)}</div>
        </div>
        <div className="px-4 py-3">
          <div className="label">Deal amount</div>
          <div className="mt-1 font-mono text-2xl font-semibold">{money(f.dealAmount)}</div>
          <div className="truncate text-xs text-faint">{f.deal ?? "no linked deal"}</div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-xs">
        <dt className="text-faint">Line items</dt><dd>{f.lineItems ?? "?"}</dd>
        <dt className="text-faint">Expires</dt><dd>{f.expiresAt ? new Date(f.expiresAt).toLocaleDateString() : "—"}</dd>
        <dt className="text-faint">Sender</dt><dd className="truncate">{f.sender ?? "—"}</dd>
        <dt className="text-faint">Recipient</dt><dd className="truncate">{f.recipient ?? "—"}</dd>
      </dl>
    </article>
  );
}

export function BookingEvidence({ e }: { e: EvidenceDTO }) {
  const f = e.fields as { hosts?: string[]; departed?: string[]; slug?: string };
  return (
    <article className="rounded-xl border border-line-2 bg-lab px-4 py-3">
      <div className="flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4 text-book" /> {e.title} <span className="font-mono text-xs text-faint">/{f.slug}</span></div>
      <ul className="mt-2 space-y-1 text-sm">
        {(f.hosts ?? []).map((h) => (
          <li key={h} className={f.departed?.includes(h) ? "text-fail" : "text-muted"}>{h}{f.departed?.includes(h) ? " · no longer on the team" : ""}</li>
        ))}
      </ul>
    </article>
  );
}

export function ContactEvidence({ list }: { list: EvidenceDTO[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-lab text-sm">
      {list.map((e) => (
        <li key={e.id} className="flex items-center gap-2 px-3.5 py-2">
          <UserRound className="h-3.5 w-3.5 text-faint" />
          <span className="truncate">{e.title}</span>
          <span className="ml-auto truncate text-xs text-muted">{Object.entries(e.fields).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

export function EvidenceList({ list, compact }: { list: EvidenceDTO[]; compact?: boolean }) {
  if (!list.length) return <p className="text-sm text-faint">No evidence recorded.</p>;
  const contacts = list.filter((e) => e.kind === "CONTACT");
  return (
    <div className="grid gap-3">
      {list.filter((e) => e.kind !== "CONTACT").slice(0, compact ? 1 : 20).map((e) =>
        e.kind === "EMAIL" ? <EmailEvidence key={e.id} e={e} compact={compact} />
        : e.kind === "QUOTE" ? <QuoteEvidence key={e.id} e={e} />
        : e.kind === "BOOKING" ? <BookingEvidence key={e.id} e={e} />
        : <SequenceEvidence key={e.id} e={e} compact={compact} />,
      )}
      {contacts.length > 0 && <ContactEvidence list={compact ? contacts.slice(0, 4) : contacts} />}
    </div>
  );
}
