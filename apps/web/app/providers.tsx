"use client";

import type { LiveEvent } from "@crash/shared";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API } from "@/lib/api";

// ---------------------------------------------------------------- toasts
type Toast = { id: number; tone: "fail" | "pass" | "info"; message: string; href?: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

function Toaster({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    // Bottom-left: the result drawer (and its Apply / Undo buttons) lives on the right.
    <div className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      <>
        {toasts.map((t) => {
          const Icon = t.tone === "fail" ? TriangleAlert : t.tone === "pass" ? CheckCircle2 : Info;
          const color = t.tone === "fail" ? "text-fail" : t.tone === "pass" ? "text-pass" : "text-run";
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line-2 bg-panel-2 px-4 py-3 shadow-2xl shadow-black/40"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
              {t.href ? (
                <a href={t.href} className="flex-1 text-sm hover:underline">{t.message}</a>
              ) : (
                <p className="flex-1 text-sm">{t.message}</p>
              )}
              <button onClick={() => dismiss(t.id)} className="text-faint hover:text-ink" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </>
    </div>
  );
}

// ---------------------------------------------------------------- live events
type Listener = (e: LiveEvent) => void;
const LiveCtx = createContext<{ subscribe: (fn: Listener) => () => void; connected: boolean; socket: Socket | null }>({
  subscribe: () => () => {},
  connected: false,
  socket: null,
});
export const useLive = () => useContext(LiveCtx);

/** Subscribe to live events; the callback always sees the latest props. */
export function useLiveEvents(fn: Listener) {
  const { subscribe } = useLive();
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

function LiveBridge({ children, push }: { children: React.ReactNode; push: (t: Omit<Toast, "id">) => void }) {
  const qc = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = io(API, { transports: ["websocket", "polling"] });
    s.on("connect", () => {
      setConnected(true);
      setSocket(s);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("event", (e: LiveEvent) => {
      listeners.current.forEach((fn) => fn(e));
      // Refetch what the event touched (§17: cache + refetch on live events).
      if ("runId" in e && e.runId) qc.invalidateQueries({ queryKey: ["run", e.runId] });
      if (e.type === "result:updated" || e.type.startsWith("fix:")) {
        const rid = (e as { resultId?: string }).resultId;
        if (rid) qc.invalidateQueries({ queryKey: ["result", rid] });
      }
      if (e.type === "run:updated" || e.type === "health:updated") {
        qc.invalidateQueries({ queryKey: ["runs"] });
        qc.invalidateQueries({ queryKey: ["workspace"] });
      }
      if (e.type.startsWith("gate:")) {
        qc.invalidateQueries({ queryKey: ["gate"] });
        qc.invalidateQueries({ queryKey: ["workspace"] });
      }
      // Sequence pages show history, health and gate events: refresh them on any of those.
      if (e.type === "run:updated" || e.type === "health:updated" || e.type.startsWith("gate:") || e.type.startsWith("fix:") || e.type === "result:updated") {
        qc.invalidateQueries({ queryKey: ["sequence"] });
      }
      if (e.type === "toast") push({ tone: e.tone, message: e.message, href: e.runId ? `/runs/${e.runId}${e.resultId ? `?result=${e.resultId}` : ""}` : undefined });
      if (e.type === "gate:checking") push({ tone: "info", message: `"${e.name}" changed. Pre-flight check running…`, href: `/runs/${e.runId}` });
    });
    return () => {
      s.close();
    };
  }, [qc, push]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);
  const value = useMemo(() => ({ subscribe, connected, socket }), [subscribe, connected, socket]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } } }));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 6000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((x) => x.filter((y) => y.id !== id)), []);
  return (
    <QueryClientProvider client={qc}>
      <ToastCtx.Provider value={push}>
        <LiveBridge push={push}>{children}</LiveBridge>
        <Toaster toasts={toasts} dismiss={dismiss} />
      </ToastCtx.Provider>
    </QueryClientProvider>
  );
}
