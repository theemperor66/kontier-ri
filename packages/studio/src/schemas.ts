import * as z from "zod";

/**
 * Zod v4 schemas — single source of truth for WebMCP inputSchema
 * (via z.toJSONSchema) AND runtime validation inside execute.
 * All object schemas are .strict(): unknown keys are rejected.
 */

export const tileTypeSchema = z.enum(["kpi", "chart", "table", "markdown"]);
export const chartTypeSchema = z.enum([
  "line",
  "bar",
  "area",
  "pie",
  "scatter",
  "combo",
  "donut",
  "hbar",
  "stacked100",
  "funnel",
  "heatmap",
  "radar",
]);
export const aggSchema = z.enum([
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "count_distinct",
  "median",
]);
export const kpiFormatSchema = z.enum(["currency", "number", "percent"]);
export const filterOpSchema = z.enum(["eq", "in", "between", "contains"]);
export const valueFormatSchema = z.enum([
  "currency",
  "number",
  "percent",
  "compact",
]);

export const layoutSchema = z
  .object({
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(24),
  })
  .strict();

// --- shared spec fragments (PLAN-V2) ----------------------------------------

export const tileFilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])).min(1).max(50),
]);

export const tileFilterSchema = z
  .object({
    column: z.string().min(1),
    op: filterOpSchema,
    value: tileFilterValueSchema,
  })
  .strict();

export const tileFiltersSchema = z.array(tileFilterSchema).max(10);

export const valueFormatOptionsSchema = z
  .object({
    style: valueFormatSchema,
    currency: z.string().length(3).optional(),
  })
  .strict();

export const formatRuleSchema = z
  .object({
    op: z.enum(["lt", "lte", "gt", "gte", "eq"]),
    value: z.number(),
    color: z.string().min(1),
  })
  .strict();

export const tileFormatSchema = z
  .object({
    value: z.union([valueFormatSchema, valueFormatOptionsSchema]).optional(),
    y2: z.union([valueFormatSchema, valueFormatOptionsSchema]).optional(),
    rules: z.array(formatRuleSchema).max(10).optional(),
  })
  .strict();

export const referenceLineSchema = z
  .object({
    value: z.number(),
    label: z.string().min(1).max(60).optional(),
    color: z.string().min(1).optional(),
  })
  .strict();

export const tileAnalyticsSchema = z
  .object({
    trendline: z.boolean().optional(),
    referenceLine: referenceLineSchema.optional(),
  })
  .strict();

export const seriesConfigSchema = z
  .object({
    key: z.string().min(1),
    type: z.enum(["bar", "line"]).optional(),
    axis: z.enum(["left", "right"]).optional(),
  })
  .strict();

// --- tile specs (docs/TOOLS.md) ---------------------------------------------

export const kpiSpecSchema = z
  .object({
    dataset: z.string().min(1),
    sql: z.string().min(1).optional(),
    measure: z.string().min(1).optional(),
    agg: aggSchema.optional(),
    format: z.union([kpiFormatSchema, valueFormatOptionsSchema]),
    compare: z.literal("prev_period").optional(),
    filters: tileFiltersSchema.optional(),
    rules: z.array(formatRuleSchema).max(10).optional(),
  })
  .strict();

export const chartMeasureSchema = z
  .object({ col: z.string().min(1), agg: aggSchema })
  .strict();

export const chartQuerySchema = z.union([
  z.object({ sql: z.string().min(1) }).strict(),
  z
    .object({
      dims: z.array(z.string().min(1)).min(1).max(3),
      measures: z.array(chartMeasureSchema).min(1).max(5),
      orderBy: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(10000).optional(),
      othersBucket: z.boolean().optional(),
    })
    .strict()
    .refine(
      (q) => !q.othersBucket || (q.limit !== undefined && q.dims.length === 1),
      {
        message:
          "othersBucket needs a limit (the N of top-N) and exactly one dim.",
      },
    ),
]);

export const chartSpecSchema = z
  .object({
    dataset: z.string().min(1),
    query: chartQuerySchema,
    chartType: chartTypeSchema,
    stacked: z.boolean().optional(),
    xKey: z.string().min(1),
    seriesKeys: z.array(z.string().min(1)).max(12).optional(),
    yKey: z.string().min(1).optional(),
    series: z.array(seriesConfigSchema).max(12).optional(),
    legend: z.boolean().optional(),
    color: z.string().min(1).optional(),
    filters: tileFiltersSchema.optional(),
    analytics: tileAnalyticsSchema.optional(),
    format: tileFormatSchema.optional(),
  })
  .strict();

export const tableSpecSchema = z
  .object({
    dataset: z.string().min(1),
    sql: z.string().min(1),
    pageSize: z.number().int().min(1).max(25).optional(),
    filters: tileFiltersSchema.optional(),
    format: tileFormatSchema.optional(),
  })
  .strict();

export const markdownSpecSchema = z
  .object({ content: z.string().min(1).max(20000) })
  .strict();

export const tileSpecSchemas = {
  kpi: kpiSpecSchema,
  chart: chartSpecSchema,
  table: tableSpecSchema,
  markdown: markdownSpecSchema,
} as const;

/** Partial per-type spec schemas — validate update_tile patches strictly. */
export const tileSpecPatchSchemas = {
  kpi: kpiSpecSchema.partial(),
  chart: chartSpecSchema.partial(),
  table: tableSpecSchema.partial(),
  markdown: markdownSpecSchema.partial(),
} as const;

// --- tool inputs: Group 1 (data, read-only) ---------------------------------

export const emptyInput = z.object({}).strict();
export const listDatasetsInput = emptyInput;
export const getDatasetSchemaInput = z
  .object({ dataset: z.string().min(1) })
  .strict();
export const profileColumnInput = z
  .object({ dataset: z.string().min(1), column: z.string().min(1) })
  .strict();
export const sampleRowsInput = z
  .object({
    dataset: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export const runSqlInput = z
  .object({
    sql: z.string().min(1),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();

// --- tool inputs: Group 2 (build, mutating) ---------------------------------

export const addTileInput = z
  .object({
    type: tileTypeSchema,
    title: z.string().min(1).max(200),
    spec: z.union([
      kpiSpecSchema,
      chartSpecSchema,
      tableSpecSchema,
      markdownSpecSchema,
    ]),
    layout: layoutSchema.optional(),
  })
  .strict();

export const tilePatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    /** Spec keys; validated against the tile's per-type schema in execute. */
    spec: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const updateTileInput = z
  .object({
    tileId: z.string().min(1),
    patch: tilePatchSchema,
    force: z.boolean().optional(),
  })
  .strict();

export const moveTileInput = z
  .object({
    tileId: z.string().min(1),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(24),
    force: z.boolean().optional(),
  })
  .strict();

export const removeTileInput = z.object({ tileId: z.string().min(1) }).strict();

export const filterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])).min(1).max(50),
]);

export const setGlobalFilterInput = z
  .object({
    column: z.string().min(1),
    op: filterOpSchema,
    value: filterValueSchema,
    force: z.boolean().optional(),
  })
  .strict();

export const clearGlobalFiltersInput = emptyInput;

export const setDateRangeInput = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    force: z.boolean().optional(),
  })
  .strict();

export const setThemeInput = z
  .object({
    palette: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(12)])
      .optional(),
    mode: z.enum(["dark", "light"]).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const setDashboardTitleInput = z
  .object({ title: z.string().min(1).max(200), force: z.boolean().optional() })
  .strict();

export const addAnnotationInput = z
  .object({
    tileId: z.string().min(1),
    text: z.string().min(1).max(1000),
    anchor: z
      .object({
        x: z.union([z.string(), z.number()]).optional(),
        seriesKey: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// --- tool inputs: Group 3 (context, read-only) ------------------------------

export const getDashboardStateInput = emptyInput;
export const getUserFocusInput = emptyInput;
export const describeTileInput = z.object({ tileId: z.string().min(1) }).strict();
export const getActivityLogInput = emptyInput;

// --- tool inputs: Group 4 (dynamic, selection-scoped) -----------------------

export const editSelectedTileInput = z
  .object({ patch: tilePatchSchema, force: z.boolean().optional() })
  .strict();

export const restyleSelectedTileInput = z
  .object({
    color: z.string().min(1).optional(),
    chartType: chartTypeSchema.optional(),
    stacked: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const explainSelectedTileInput = emptyInput;

// --- tool inputs: Group 5 (PLAN-V2 — pages, cross-filter, calc fields, views)

export const identifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    "Use letters, digits and underscores (no leading digit).",
  );

export const addPageInput = z
  .object({ name: z.string().min(1).max(60) })
  .strict();
export const renamePageInput = z
  .object({
    pageId: z.string().min(1),
    name: z.string().min(1).max(60),
    force: z.boolean().optional(),
  })
  .strict();
export const removePageInput = z.object({ pageId: z.string().min(1) }).strict();
export const switchPageInput = z.object({ pageId: z.string().min(1) }).strict();

export const setCrossFilterInput = z
  .object({
    column: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
    sourceTileId: z.string().min(1).optional(),
  })
  .strict();
export const clearCrossFilterInput = emptyInput;

export const setTileFiltersInput = z
  .object({
    tileId: z.string().min(1),
    /** Empty array clears the tile's filters. */
    filters: z.array(tileFilterSchema).max(10),
    force: z.boolean().optional(),
  })
  .strict();

export const createCalculatedFieldInput = z
  .object({
    name: identifierSchema,
    dataset: z.string().min(1),
    /** SQL expression fragment, e.g. sum(amount)/count(DISTINCT customer_id). */
    expression: z.string().min(1).max(2000),
    description: z.string().min(1).max(300).optional(),
  })
  .strict();
export const listCalculatedFieldsInput = emptyInput;
export const removeCalculatedFieldInput = z
  .object({ name: identifierSchema })
  .strict();

export const createViewInput = z
  .object({
    /** Namespaced automatically: "mrr" becomes "view_mrr". */
    name: z.string().min(1).max(64),
    /** SELECT-only body (read-only guard; single statement). */
    sql: z.string().min(1).max(10000),
    description: z.string().min(1).max(300).optional(),
  })
  .strict();
export const removeViewInput = z
  .object({ name: z.string().min(1).max(64) })
  .strict();

export const exportTileDataInput = z
  .object({
    tileId: z.string().min(1),
    limit: z.number().int().min(1).max(1000).default(500),
  })
  .strict();

// --- tool inputs: Group 6 (agent presence — plan card / insight tray) -------

export const planStepStatusSchema = z.enum([
  "pending",
  "active",
  "done",
  "failed",
]);
export const insightSeveritySchema = z.enum(["info", "warn", "critical"]);

export const planStepInputSchema = z
  .object({
    label: z.string().min(1).max(120),
    /** Defaults to "pending" in the store. */
    status: planStepStatusSchema.optional(),
  })
  .strict();

export const presentPlanInput = z
  .object({
    title: z.string().min(1).max(120).optional(),
    steps: z.array(planStepInputSchema).min(1).max(12),
  })
  .strict();

export const updatePlanStepInput = z
  .object({
    /** 0-based index into the shared plan's steps. */
    index: z.number().int().min(0).max(11),
    status: planStepStatusSchema,
  })
  .strict();

export const clearPlanInput = emptyInput;

/**
 * Strict suggested-action shape for propose_insight. Executed through the
 * EXISTING command layer (origin "agent", undoable) only when the user
 * clicks Accept — never on propose.
 */
export const suggestedActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add_annotation"),
      payload: z
        .object({
          tileId: z.string().min(1),
          text: z.string().min(1).max(1000),
          anchor: z
            .object({
              x: z.union([z.string(), z.number()]).optional(),
              seriesKey: z.string().min(1).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("add_tile"),
      /** Same shape as the add_tile tool input (spec re-checked per type). */
      payload: addTileInput,
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_filter"),
      payload: z
        .object({
          column: z.string().min(1),
          op: filterOpSchema,
          value: filterValueSchema,
        })
        .strict(),
    })
    .strict(),
]);

export const proposeInsightInput = z
  .object({
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(600),
    severity: insightSeveritySchema.default("info"),
    tileId: z.string().min(1).optional(),
    suggestedAction: suggestedActionSchema.optional(),
  })
  .strict();
