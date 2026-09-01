"use client";

/**
 * Raw-SQL editing block: readonly SQL view + "Edit as SQL" textarea.
 * Apply validates the statement against the datasource guard (SELECT-only,
 * row-capped) by actually running it; failures render inline and are never
 * committed.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { dataSource } from "@/lib/datasource";
import { controlCls, FieldShell } from "./fields";
import { useId } from "react";
import { cn } from "@/lib/utils";

export function SqlEditor({
  sql,
  onApply,
  hint,
  testIdPrefix,
}: {
  sql: string;
  /** Called with the validated SQL; the caller commits via updateTile. */
  onApply: (sql: string) => void;
  hint?: string;
  testIdPrefix: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sql);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await dataSource.runQuery(draft);
      onApply(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="space-y-1.5">
        <span className="block text-[11px] font-medium text-muted-foreground">
          SQL
        </span>
        <pre
          data-testid={`${testIdPrefix}-sql-view`}
          className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
        >
          {sql}
        </pre>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          data-testid={`${testIdPrefix}-edit-sql`}
          onClick={() => {
            setDraft(sql);
            setError(null);
            setEditing(true);
          }}
        >
          Edit as SQL
        </Button>
        {hint ? (
          <p className="text-[11px] leading-snug text-muted-foreground/70">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <FieldShell label="SQL" id={id} error={error}>
        <textarea
          id={id}
          data-testid={`${testIdPrefix}-sql-input`}
          value={draft}
          rows={8}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Escape cancels SQL editing without closing the panel.
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
              setError(null);
            }
          }}
          className={cn(
            controlCls(!!error),
            "h-auto resize-y py-1.5 font-mono text-[11px] leading-relaxed",
          )}
        />
      </FieldShell>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={busy || draft.trim().length === 0}
          data-testid={`${testIdPrefix}-apply-sql`}
          onClick={() => void apply()}
        >
          {busy ? "Validating…" : "Apply"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground/70">
        Validated on apply: SELECT-only, row-capped by the data guard.
      </p>
    </div>
  );
}
