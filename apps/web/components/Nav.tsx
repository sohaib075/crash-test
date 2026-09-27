"use client";

import type { ReadyDTO, WorkspaceDTO } from "@crash/shared";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { OctagonAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLive } from "@/app/providers";
import { api } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Workspace" },
  { href: "/runs", label: "Runs" },
  { href: "/gate", label: "Gate" },
  { href: "/report", label: "Report" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  const { connected } = useLive();
  const ready = useQuery({ queryKey: ["ready-lite"], queryFn: () => api<ReadyDTO>("/api/ready?lite=1"), refetchInterval: 30_000, staleTime: 30_000 });
  const ws = useQuery({ queryKey: ["workspace"], queryFn: () => api<WorkspaceDTO | null>("/api/workspace") });
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/sequences") : path.startsWith(href));
  // Shared read-only reports show the brand only, no app navigation.
  if (path.startsWith("/r/")) {
    return (
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2.5 px-4 sm:px-6">
          <span className="dummy" aria-hidden />
          <span className="font-display text-[17px] font-bold tracking-tight">Crash Test</span>
        </div>
      </header>
    );
  }
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-lab/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="dummy" aria-hidden />
          <span className="font-display text-[17px] font-bold tracking-tight">Crash Test</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1.5 text-sm transition ${active(l.href) ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs">
          {ws.data && <span className="hidden font-mono text-muted lg:inline">{ws.data.name}</span>}
          <Link href="/ready" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono ${ready.data?.ok ? "border-pass/40 text-pass" : "border-line-2 text-muted"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${ready.data?.ok ? "bg-pass" : ready.isLoading ? "bg-faint" : "bg-action"}`} />
            {ready.isLoading ? "checking" : ready.data?.ok ? "ready" : "not ready"}
          </Link>
          <span className={`hidden items-center gap-1.5 font-mono sm:inline-flex ${connected ? "text-muted" : "text-fail"}`} title={connected ? "Live updates on" : "Live updates off"}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-pass" : "bg-fail"}`} />
            {connected ? "live" : "offline"}
          </span>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden" aria-label="Main mobile">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`shrink-0 rounded-lg px-3 py-1 text-sm ${active(l.href) ? "bg-panel-2 text-ink" : "text-muted"}`}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Red banner across every page while the gate is blocking a change (§14). */
export function GateBanner() {
  const path = usePathname();
  const ws = useQuery({ queryKey: ["workspace"], queryFn: () => api<WorkspaceDTO | null>("/api/workspace") });
  const blocked = ws.data?.gate.blocked ?? [];
  return (
    <AnimatePresence>
      {blocked.length > 0 && !path.startsWith("/r/") && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-fail/40 bg-fail/10" role="alert">
          <div className="flex">
            <div className="hazard w-2 shrink-0" />
            <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-6">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold tracking-widest text-fail">
                <OctagonAlert className="h-4 w-4" /> BLOCKED
              </span>
              <span className="text-sm">{blocked[0].message}</span>
              <Link href="/gate" className="ml-auto text-sm text-action hover:underline">
                See what changed →
              </Link>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
