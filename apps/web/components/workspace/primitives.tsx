"use client";

/**
 * Shared presentation primitives for the workspace views. Sizes, radii and
 * inks come straight from the approved product design (docs/DESIGN-SPEC.md).
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

const PILL_TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted-foreground",
  accent: "bg-accent-soft text-accent-strong",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-faint",
  accent: "bg-accent-strong",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

/** Scroll container for a full-page workspace view (design: 6px 4px 20px). */
export function WorkspacePage({
  children,
  className,
  testId,
  label,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-1 pb-5 pt-1.5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">
          {title}
        </h1>
        <p className="text-[15px] leading-normal text-muted-foreground">
          {subtitle}
        </p>
      </div>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Surface card: 12px radius, hairline border, design shadow. */
export function Card({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "className" | "children"
>) {
  return (
    <div
      className={cn("rounded-xl border border-line bg-surface", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  sub,
  size = "md",
  actions,
}: {
  children: ReactNode;
  sub?: ReactNode;
  size?: "sm" | "md" | "lg";
  actions?: ReactNode;
}) {
  const sizes = { sm: "text-[14px]", md: "text-[15px]", lg: "text-[19px]" };
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className={cn("font-semibold tracking-[-0.01em]", sizes[size])}>
          {children}
        </h2>
        {sub ? (
          <p className="text-[12.5px] leading-snug text-faint">{sub}</p>
        ) : null}
      </div>
      {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-[11.5px] font-medium",
        PILL_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral" }: { tone?: Tone }) {
  return (
    <span
      aria-hidden
      className={cn("size-[7px] shrink-0 rounded-full", DOT_TONE[tone])}
    />
  );
}

/** 4-up stat card from the design: tinted glyph square + label + value. */
export function StatCard({
  icon,
  label,
  value,
  tone = "accent",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface px-[18px] py-4">
      <span
        aria-hidden
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[9px]",
          PILL_TONE[tone],
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13.5px] text-muted-foreground">{label}</span>
        <span className="truncate text-[18px] font-semibold">{value}</span>
      </span>
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline";
  size?: "sm" | "md";
};

/** Design control: 34px (md) / 30px (sm), radius 8px, 13.5px label. */
export function ActionButton({
  variant = "outline",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm"
          ? "h-[30px] px-3 text-[12.5px]"
          : "h-[34px] px-3.5 text-[13.5px]",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-line-2 bg-transparent text-foreground hover:bg-surface-2",
        className,
      )}
      {...rest}
    />
  );
}

/** Dashed empty panel (design copy lives at the call site). */
export function EmptyPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-line-2 px-6 py-10 text-center text-[14px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Square initials/glyph avatar (36px in lists, 22–26px in dense rows). */
export function Avatar({
  children,
  tone = "accent",
  size = 36,
  label,
}: {
  children: ReactNode;
  tone?: Tone;
  size?: number;
  label?: string;
}) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      style={{ width: size, height: size }}
      className={cn(
        "grid shrink-0 place-items-center rounded-[9px] text-[13px] font-semibold",
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Mono SQL / formula line (the only place the design uses mono). */
export function Mono({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <code
      title={title}
      className={cn(
        "min-w-0 truncate font-mono text-[12px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </code>
  );
}
