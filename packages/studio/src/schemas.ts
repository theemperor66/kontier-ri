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

// --- tool inputs: Group 7 (collaboration session / structured decisions) ----

export const getWorkContextInput = emptyInput;

export const decisionOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

/**
 * Ask only when a material ambiguity needs a human choice. Option ids are
 * unique and the recommendation, when present, must name one of them.
 */
export const requestDecisionInput = z
  .object({
    question: z.string().trim().min(1).max(300),
    context: z.string().trim().min(1).max(1200),
    options: z.array(decisionOptionSchema).min(2).max(5),
    recommendedOptionId: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    for (const [index, option] of input.options.entries()) {
      if (seen.has(option.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["options", index, "id"],
          message: `Duplicate option id "${option.id}".`,
        });
      }
      seen.add(option.id);
    }
    if (
      input.recommendedOptionId !== undefined &&
      !seen.has(input.recommendedOptionId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["recommendedOptionId"],
        message: "recommendedOptionId must name one of the options.",
      });
    }
  });

export const completeWorkInput = z
  .object({
    summary: z.string().trim().min(1).max(1200),
    outcomes: z.array(z.string().trim().min(1).max(300)).max(20),
  })
  .strict();

/** Inferred tool input types, exported for non-store WebMCP consumers. */
export type RequestDecisionToolInput = z.infer<typeof requestDecisionInput>;
export type CompleteWorkToolInput = z.infer<typeof completeWorkInput>;

// --- tool inputs: Group 8 (staged change sets — reviewable multi-edit) ------

/** Short per-action reason, shown next to that row in the review card. */
export const changeActionNoteSchema = z.string().trim().min(1).max(200);

/** update_tile patch that actually changes something. */
export const nonEmptyTilePatchSchema = tilePatchSchema.refine(
  (patch) =>
    patch.title !== undefined ||
    (patch.spec !== undefined && Object.keys(patch.spec).length > 0),
  { message: "Patch is empty: provide title and/or spec keys." },
);

export const globalFilterPayloadSchema = z
  .object({
    column: z.string().min(1),
    op: filterOpSchema,
    value: filterValueSchema,
  })
  .strict();

/**
 * One staged edit. Executed through the EXISTING command layer (origin
 * "agent", undoable) only when the human applies the set — never on propose.
 */
export const changeActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add_tile"),
      /** Same shape as the add_tile tool input. */
      payload: addTileInput,
      note: changeActionNoteSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("update_tile"),
      payload: z
        .object({
          tileId: z.string().min(1),
          patch: nonEmptyTilePatchSchema,
        })
        .strict(),
      note: changeActionNoteSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("remove_tile"),
      payload: z.object({ tileId: z.string().min(1) }).strict(),
      note: changeActionNoteSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("add_annotation"),
      payload: addAnnotationInput,
      note: changeActionNoteSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_filter"),
      payload: globalFilterPayloadSchema,
      note: changeActionNoteSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_tile_filters"),
      payload: z
        .object({
          tileId: z.string().min(1),
          /** Empty array clears the tile's filters. */
          filters: z.array(tileFilterSchema).max(10),
        })
        .strict(),
      note: changeActionNoteSchema.optional(),
    })
    .strict(),
]);

/** Tile the action targets, when it targets one (propose-time checks). */
function actionTileId(action: z.output<typeof changeActionSchema>): string | null {
  return action.kind === "add_tile" || action.kind === "set_filter"
    ? null
    : action.payload.tileId;
}

/** Shared refinement: no duplicate rows, no edits after a removal. */
function checkActionList(
  actions: z.output<typeof changeActionSchema>[],
  ctx: z.RefinementCtx,
  path: (string | number)[] = ["actions"],
): void {
  const seen = new Map<string, number>();
  actions.forEach((action, index) => {
    const key = JSON.stringify([action.kind, action.payload]);
    const first = seen.get(key);
    if (first !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Duplicate action: index ${index} repeats index ${first}.`,
      });
    } else {
      seen.set(key, index);
    }
  });
  const removed = new Map<string, number>();
  actions.forEach((action, index) => {
    if (action.kind === "remove_tile") removed.set(action.payload.tileId, index);
  });
  actions.forEach((action, index) => {
    const tileId = actionTileId(action);
    if (!tileId || action.kind === "remove_tile") return;
    const removedAt = removed.get(tileId);
    if (removedAt !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Action ${index} edits tile "${tileId}", which action ${removedAt} removes.`,
      });
    }
  });
}

export const changeActionsSchema = z
  .array(changeActionSchema)
  .min(1, "A change set needs at least one action.")
  .max(8, "A change set holds at most 8 actions; split larger work.");

export const proposeChangeSetInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    rationale: z.string().trim().min(1).max(600),
    actions: changeActionsSchema,
  })
  .strict()
  .superRefine((input, ctx) => checkActionList(input.actions, ctx));

export const applyChangeSetInput = z
  .object({
    changeSetId: z.string().min(1),
    /** 0-based indexes the human dropped during review. */
    skipIndexes: z.array(z.number().int().min(0).max(7)).max(8).optional(),
  })
  .strict();

export const reviseChangeSetInput = z
  .object({
    changeSetId: z.string().min(1),
    title: z.string().trim().min(1).max(120).optional(),
    rationale: z.string().trim().min(1).max(600).optional(),
    actions: changeActionsSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.title === undefined &&
      input.rationale === undefined &&
      input.actions === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Provide title, rationale and/or actions to revise.",
      });
    }
    if (input.actions) checkActionList(input.actions, ctx);
  });

export const withdrawChangeSetInput = z
  .object({ changeSetId: z.string().min(1) })
  .strict();

export const withdrawDecisionInput = z
  .object({ decisionId: z.string().min(1) })
  .strict();

export type ChangeActionToolInput = z.infer<typeof changeActionSchema>;
export type ProposeChangeSetToolInput = z.infer<typeof proposeChangeSetInput>;
export type ApplyChangeSetToolInput = z.infer<typeof applyChangeSetInput>;
export type ReviseChangeSetToolInput = z.infer<typeof reviseChangeSetInput>;
