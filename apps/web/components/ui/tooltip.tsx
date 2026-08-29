"use client";

/** Lightweight CSS tooltip (no portal): wraps trigger, shows on hover/focus. */
import * as React from "react";
import { cn } from "@/lib/utils";

export function Tooltip({
  content,
  side = "bottom",
  className,
  children,
}: {
  content: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-72 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}
