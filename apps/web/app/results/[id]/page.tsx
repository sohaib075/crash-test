"use client";

import type { ResultDTO } from "@crash/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { ErrorBox, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";

/** Deep link to a result: opens its run board with the drawer open. */
export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const q = useQuery({ queryKey: ["result", id], queryFn: () => api<ResultDTO>(`/api/results/${id}`) });
  useEffect(() => {
    if (q.data) router.replace(`/runs/${q.data.runId}?result=${id}`);
  }, [q.data, id, router]);
  if (q.error) return <ErrorBox error={q.error} />;
  return <Skeleton className="h-64" />;
}
