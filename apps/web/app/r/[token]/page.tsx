"use client";

import type { ReportDTO } from "@crash/shared";
import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { ReportCard } from "@/components/ReportCard";
import { ErrorBox, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";

/** Public read-only report a RevOps lead can forward (§10). */
export default function SharedReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const q = useQuery({ queryKey: ["public-report", token], queryFn: () => api<ReportDTO>(`/api/public/reports/${token}`) });
  return (
    <div className="space-y-6">
      <div>
        <div className="label">Shared report · read only</div>
        <h1 className="font-display text-2xl font-bold">Crash Test · revenue machine check</h1>
      </div>
      {q.error && <ErrorBox error={q.error} />}
      {q.isLoading ? <Skeleton className="h-96" /> : q.data && <ReportCard r={q.data} />}
    </div>
  );
}
