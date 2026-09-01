"use client";

/**
 * Labeled form primitives for the tile inspector. Every control gets a real
 * <label> (a11y) and an inline invalid state: red hairline + message. The
 * caller decides whether to commit — invalid values must never be applied.
 */

import { useId } from "react";
import { cn } from "@/lib/utils";

export function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="border-b border-border/60 px-4 py-3">
      <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function controlCls(invalid?: boolean): string {
  return cn(
    "h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/60",
    invalid ? "border-destructive" : "border-input",
  );
}

export function FieldShell({
  label,
  id,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label
        htmlFor={id}
        className="block text-[11px] font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[11px] leading-snug text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-snug text-muted-foreground/70">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <FieldShell label={label} id={id} hint={hint} error={error}>
      <select
        id={id}
        data-testid={testId}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          controlCls(!!error),
          "disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-popover [&>option]:text-popover-foreground",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextField({
  label,
  value,
  onChange,
  onFlush,
  placeholder,
  hint,
  error,
  type = "text",
  testId,
  textarea,
  rows,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called on blur / Enter so a pending debounce can commit immediately. */
  onFlush?: () => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  type?: "text" | "number";
  testId?: string;
  textarea?: boolean;
  rows?: number;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <FieldShell label={label} id={id} hint={hint} error={error}>
      {textarea ? (
        <textarea
          id={id}
          data-testid={testId}
          value={value}
          rows={rows ?? 6}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onFlush}
          className={cn(
            controlCls(!!error),
            "h-auto resize-y py-1.5 leading-relaxed",
            mono && "font-mono text-[11px]",
          )}
        />
      ) : (
        <input
          id={id}
          data-testid={testId}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onFlush}
          onKeyDown={(e) => {
            if (e.key === "Enter") onFlush?.();
          }}
          className={controlCls(!!error)}
        />
      )}
    </FieldShell>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
  hint,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <label
        htmlFor={id}
        className={cn(
          "min-w-0 text-xs text-foreground",
          disabled && "opacity-50",
        )}
      >
        {label}
        {hint ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/70">
            {hint}
          </span>
        ) : null}
      </label>
      <input
        id={id}
        data-testid={testId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** Inline row error: red hairline message under a list row. */
export function RowError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[11px] leading-snug text-destructive">
      {message}
    </p>
  );
}
