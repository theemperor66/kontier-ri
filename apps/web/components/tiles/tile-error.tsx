"use client";

import { WarningCircle } from "@phosphor-icons/react";

export function TileError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-start gap-2 overflow-hidden p-1 text-xs text-destructive/90">
      <WarningCircle className="mt-0.5 size-4 shrink-0" />
      <span className="line-clamp-4 break-words font-mono">{message}</span>
    </div>
  );
}
