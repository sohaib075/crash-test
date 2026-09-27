"use client";

import type { ReportDTO } from "@crash/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/app/providers";
import { ReportCard } from "@/components/ReportCard";
import { Button, ErrorBox, Skeleton } from "@/components/ui";
import { api, post } from "@/lib/api";

export default function ReportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["report"], queryFn: () => api<ReportDTO | null>("/api/reports/latest") });
  const set = (r: ReportDTO) => qc.setQueryData(["report"], r);
  const build = useMutation({ mutationFn: () => post<ReportDTO>("/api/reports"), onSuccess: (r) => { set(r); setLink(null); }, onError: (e: Error) => toast({ tone: "fail", message: e.message }) });
  const save = useMutation({
    mutationFn: (id: string) => post<ReportDTO>(`/api/reports/${id}/save`),
    onSuccess: (r) => { set(r); toast({ tone: "pass", message: "Saved to graph8 as a task" }); },
    onError: (e: Error) => toast({ tone: "fail", message: e.message }),
  });
  const share = useMutation({
    mutationFn: (id: string) => post<ReportDTO>(`/api/reports/${id}/share`),
    onSuccess: async (r) => {
      set(r);
      const url = `${window.location.origin}/r/${r.shareToken}`;
      let ok = false;
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch {
        /* no clipboard permission (or not a secure context): show the link instead */
      }
      if (ok) {
        setLink(null);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        toast({ tone: "info", message: "Read-only link copied" });
      } else {
        setLink(url);
        toast({ tone: "info", message: "Couldn't copy automatically. The link is shown below." });
      }
    },
    onError: (e: Error) => toast({ tone: "fail", message: e.message }),
  });
  const r = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Monday report</h1>
          <p className="text-sm text-muted">What ran, what broke, what we fixed, and the leads and pipeline it caught.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" loading={build.isPending} onClick={() => build.mutate()}><RefreshCw className="h-4 w-4" /> Build now</Button>
          {r && (
            <>
              <Button variant="primary" loading={save.isPending} disabled={!!r.graph8TaskId} onClick={() => save.mutate(r.id)}>
                {r.graph8TaskId ? <><CheckCircle2 className="h-4 w-4" /> Saved to graph8</> : <><Save className="h-4 w-4" /> Save to graph8</>}
              </Button>
              <Button variant="outline" loading={share.isPending} onClick={() => share.mutate(r.id)}><Link2 className="h-4 w-4" /> {copied ? "Copied" : "Copy share link"}</Button>
            </>
          )}
        </div>
      </div>
      {link && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-2 bg-panel px-4 py-3 text-sm">
          <span className="text-muted">Read-only link:</span>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" className="min-w-0 flex-1 rounded-md border border-line bg-lab px-2 py-1 font-mono text-xs" />
          <a href={link} target="_blank" rel="noreferrer" className="text-action hover:underline">Open</a>
        </div>
      )}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <Skeleton className="h-96" /> : q.error && !r ? null : r ? <ReportCard r={r} /> : (
        <div className="rounded-2xl border border-dashed border-line-2 p-10 text-center text-muted">No report yet. Run the tests, then press &quot;Build now&quot;.</div>
      )}
    </div>
  );
}
