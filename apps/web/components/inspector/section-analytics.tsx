"use client";

/**
 * Inspector Analytics section: trendline toggle + reference-line value, for
 * the chart types whose renderers actually draw them (see chart-types.ts).
 */

import { useEffect, useState } from "react";
import type { ChartSpec, Tile } from "@/lib/dashboard-store";
import { commitSpec, useDebounced } from "./commit";
import { Section, TextField, ToggleField } from "./fields";
import { REFERENCE_LINE_TYPES, TRENDLINE_TYPES } from "./chart-types";

export function AnalyticsSection({ tile }: { tile: Tile }) {
  const spec = tile.spec as ChartSpec;
  const analytics = spec.analytics ?? {};
  const supportsTrend = TRENDLINE_TYPES.has(spec.chartType);
  const supportsRef = REFERENCE_LINE_TYPES.has(spec.chartType);

  const commitAnalytics = (
    patch: Partial<NonNullable<ChartSpec["analytics"]>>,
    label: string,
  ) => {
    const next = { ...analytics, ...patch };
    if (next.trendline !== true) delete next.trendline;
    if (next.referenceLine == null) delete next.referenceLine;
    commitSpec(
      tile.id,
      { analytics: Object.keys(next).length > 0 ? next : undefined },
      label,
    );
  };

  const [refDraft, setRefDraft] = useState(
    analytics.referenceLine != null ? String(analytics.referenceLine.value) : "",
  );
  useEffect(() => {
    setRefDraft(
      analytics.referenceLine != null
        ? String(analytics.referenceLine.value)
        : "",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics.referenceLine?.value]);
  const refTrim = refDraft.trim();
  const refError =
    refTrim === "" || Number.isFinite(Number(refTrim))
      ? null
      : "Enter a number.";
  const refDebounce = useDebounced((raw: string) => {
    const t = raw.trim();
    if (t === "") {
      commitAnalytics(
        { referenceLine: undefined },
        `Removed the “${tile.title}” reference line`,
      );
      return;
    }
    if (!Number.isFinite(Number(t))) return;
    commitAnalytics(
      {
        referenceLine: {
          ...(analytics.referenceLine ?? {}),
          value: Number(t),
        },
      },
      `Set “${tile.title}” reference line to ${t}`,
    );
  });

  const [labelDraft, setLabelDraft] = useState(
    analytics.referenceLine?.label ?? "",
  );
  useEffect(() => {
    setLabelDraft(analytics.referenceLine?.label ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics.referenceLine?.label]);
  const labelDebounce = useDebounced((raw: string) => {
    if (analytics.referenceLine == null) return;
    const t = raw.trim();
    commitAnalytics(
      {
        referenceLine: {
          ...analytics.referenceLine,
          label: t === "" ? undefined : t,
        },
      },
      `Labeled the “${tile.title}” reference line`,
    );
  });

  if (!supportsTrend && !supportsRef) return null;

  return (
    <Section title="Analytics" testId="inspector-analytics">
      {supportsTrend ? (
        <ToggleField
          label="Trendline"
          testId="inspector-trendline"
          checked={analytics.trendline === true}
          hint="Dashed linear regression over the first series."
          onChange={(v) =>
            commitAnalytics(
              { trendline: v ? true : undefined },
              v
                ? `Added a trendline to “${tile.title}”`
                : `Removed the “${tile.title}” trendline`,
            )
          }
        />
      ) : null}
      {supportsRef ? (
        <>
          <TextField
            label="Reference line value"
            testId="inspector-refline"
            type="number"
            value={refDraft}
            placeholder="None"
            error={refError}
            onChange={(v) => {
              setRefDraft(v);
              refDebounce.call(v);
            }}
            onFlush={refDebounce.flush}
          />
          {analytics.referenceLine != null ? (
            <TextField
              label="Reference line label"
              testId="inspector-refline-label"
              value={labelDraft}
              placeholder="Optional label"
              onChange={(v) => {
                setLabelDraft(v);
                labelDebounce.call(v);
              }}
              onFlush={labelDebounce.flush}
            />
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
