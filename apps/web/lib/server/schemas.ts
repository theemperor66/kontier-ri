/**
 * WHAT: zod schemas for every workspace API request body, plus the id and
 * query-parameter guards used by the route handlers.
 *
 * WHY: the API is written by one team and called by another (the client store
 * in packages/workspace), so "invalid body" must be a documented 400 with a
 * usable message instead of a 500 from deep inside the store. Bodies are
 * validated at the edge and the store only ever sees well-formed data.
 *
 * The dashboard document is validated as "a JSON object" and nothing more.
 * Its real schema lives in the client and keeps evolving; a server that
 * pinned that schema would reject next week's documents.
 */

import { z } from "zod";

/** Opaque document: a JSON object, contents untouched (see file header). */
export const docSchema = z.record(z.string(), z.unknown());

/** Ids come from clients; keep them short and filesystem/JSON-safe. */
export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "id may only contain letters, digits and . _ : -");

const nameSchema = z.string().trim().min(1).max(200);
const labelSchema = z.string().trim().min(1).max(200);
/** epoch ms; bounded so a broken clock cannot poison the log. */
const timestampSchema = z.number().int().min(0).max(4_102_444_800_000);

export const putDashboardSchema = z.strictObject({
  name: nameSchema,
  doc: docSchema,
});

export const postVersionSchema = z.strictObject({
  label: labelSchema,
  doc: docSchema,
});

export const commandEntrySchema = z.strictObject({
  by: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(500),
  at: timestampSchema,
  actor: z.string().trim().min(1).max(120),
});

export const postCommandsSchema = z.strictObject({
  entries: z.array(commandEntrySchema).min(1).max(200),
});

export const presenceSchema = z.strictObject({
  actor: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  dashboardId: idSchema.nullable(),
});

export const investigationSchema = z.strictObject({
  id: idSchema,
  objective: z.string().max(2_000),
  summary: z.string().max(20_000),
  outcomes: z.array(z.string().max(2_000)).max(200),
  decisions: z
    .array(
      z.strictObject({
        question: z.string().max(2_000),
        answer: z.string().max(2_000),
        note: z.string().max(2_000).optional(),
      }),
    )
    .max(200),
  approvedChanges: z.number().int().min(0).max(1_000_000),
  dashboardTitle: z.string().max(500),
  startedAt: timestampSchema,
  completedAt: timestampSchema,
});

/** `?since=N`: absent or blank means "from the beginning". */
export const sinceSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export type PutDashboardBody = z.infer<typeof putDashboardSchema>;
export type PostVersionBody = z.infer<typeof postVersionSchema>;
export type PostCommandsBody = z.infer<typeof postCommandsSchema>;
export type PresenceBody = z.infer<typeof presenceSchema>;
export type InvestigationBody = z.infer<typeof investigationSchema>;
