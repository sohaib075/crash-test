"use client";

import type { Area, TestStatus } from "@crash/shared";
import { animate, useMotionValue, useReducedMotion, useTransform, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { AREA_STYLE, STATUS_STYLE } from "@/lib/format";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; loading?: boolean; size?: "sm" | "md" | "lg" };

export function Button({ variant = "outline", loading, size = "md", className = "", children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-action text-black font-semibold hover:brightness-110 shadow-[0_0_0_1px_rgba(0,0,0,.2)]",
    ghost: "text-muted hover:text-ink hover:bg-panel-2",
    outline: "border border-line-2 text-ink hover:border-muted hover:bg-panel-2",
    danger: "border border-fail/50 text-fail hover:bg-fail/10",
  }[variant];
  const s = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" }[size];
  return (
    <button {...rest} disabled={disabled || loading} className={`inline-flex items-center justify-center gap-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed ${v} ${s} ${className}`}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Panel({ title, right, children, className = "", pad = true }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="label !text-[11.5px]">{title}</h2>
          {right}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function AreaTag({ area }: { area: Area }) {
  const a = AREA_STYLE[area];
  return <span className={`font-mono text-[11px] font-semibold tracking-[0.1em] ${a.text}`}>{a.label.toUpperCase()}</span>;
}

export function StatusPill({ status }: { status: TestStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-current/30 px-2 py-0.5 text-xs font-medium ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${status === "RUNNING" ? "animate-pulse" : ""}`} />
      {s.label}
    </span>
  );
}

/** Numbers count up (§14). Off under reduced motion. */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString("en-US") }: { value: number; format?: (n: number) => string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.9, ease: "easeOut" });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span>{text}</motion.span>;
}

export function StatTile({ label, value, tone = "", format, hint }: { label: string; value: number; tone?: string; format?: (n: number) => string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 font-mono text-[28px] leading-none font-semibold tabular-nums ${tone}`}>
        <CountUp value={value} format={format} />
      </div>
      {hint && <div className="mt-1.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function HealthRing({ score, size = 64, stroke = 6 }: { score: number | null; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = score == null ? "var(--line-2)" : score >= 85 ? "var(--pass)" : score >= 60 ? "var(--action)" : "var(--fail)";
  const reduce = useReducedMotion();
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={score == null ? "Not tested yet" : `Health ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {score != null && (
          <motion.circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
            initial={{ strokeDashoffset: reduce ? c * (1 - score / 100) : c }}
            animate={{ strokeDashoffset: c * (1 - score / 100) }}
            transition={{ duration: reduce ? 0 : 1, ease: "easeOut" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center font-mono font-semibold tabular-nums" style={{ fontSize: size * 0.3, color: score == null ? "var(--faint)" : color }}>
        {score ?? "–"}
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as { message?: string; hint?: string; code?: string };
  return (
    <div className="rounded-xl border border-fail/40 bg-fail/5 px-4 py-3 text-sm" role="alert">
      <div className="font-medium text-fail">{e?.message ?? "Something went wrong"}</div>
      {e?.hint && <div className="mt-0.5 text-muted">{e.hint}</div>}
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          Retry now
        </Button>
      )}
    </div>
  );
}
