import * as z from "zod";

/**
 * Zod v4 schemas — single source of truth for WebMCP inputSchema
 * (via z.toJSONSchema) AND runtime validation inside execute.
 * All object schemas are .strict(): unknown keys are rejected.
 */

export const tileTypeSchema = z.enum(["kpi", "chart", "table", "markdown"]);
export const chartTypeSchema = z.enum(["line", "bar", "area", "pie"]);
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

export const layoutSchema = z
  .object({
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(24),
  })
  .strict();

// --- tile specs (docs/TOOLS.md) ---------------------------------------------

export const kpiSpecSchema = z
  .object({
    dataset: z.string().min(1),
    sql: z.string().min(1).optional(),
    measure: z.string().min(1).optional(),
    agg: aggSchema.optional(),
    format: kpiFormatSchema,
    compare: z.literal("prev_period").optional(),
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
    })
    .strict(),
]);

export const chartSpecSchema = z
  .object({
    dataset: z.string().min(1),
    query: chartQuerySchema,
    chartType: chartTypeSchema,
    stacked: z.boolean().optional(),
    xKey: z.string().min(1),
    seriesKeys: z.array(z.string().min(1)).max(12).optional(),
    color: z.string().min(1).optional(),
  })
  .strict();

export const tableSpecSchema = z
  .object({
    dataset: z.string().min(1),
    sql: z.string().min(1),
    pageSize: z.number().int().min(1).max(25).optional(),
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
