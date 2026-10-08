/**
 * The automation issues the app reads off the wire: a draft check's answer
 * (`POST /api/app/automations/:name/validate`), the `errors` and `warnings`
 * a refused save or deploy carries under `data`, and the `warnings` a
 * successful save returns.
 *
 * The engine's own `Issue` (`lib/engine/core/types.ts`) is the source of
 * truth; this schema reads what the editor uses of it, so a malformed or
 * foreign answer is refused at the boundary instead of travelling into the
 * Problems panel as a cast. Fields the editor does not read (`related`, the
 * analysis and the inferred types) are left out and stripped. A code is any
 * string: a newer server's code still reads, as a problem this build has no
 * words for.
 */

import { z } from 'zod';

const issueLocationSchema = z.object({
  pointer: z.string(),
  range: z.tuple([z.number().int(), z.number().int()]).optional(),
  subject: z.enum(['value', 'key', 'missing']).optional(),
});

const issueParamValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);

export const issueSchema = z.object({
  level: z.enum(['error', 'warning']),
  code: z.string(),
  nodeId: z.string().optional(),
  path: z.string().optional(),
  message: z.string(),
  hint: z.string().optional(),
  at: issueLocationSchema.optional(),
  params: z.record(z.string(), issueParamValueSchema).optional(),
});

export type WireAutomationIssue = z.infer<typeof issueSchema>;

/** A draft check's answer: the issues, split by level. */
export const validationAnswerSchema = z.object({
  valid: z.boolean(),
  errors: z.array(issueSchema),
  warnings: z.array(issueSchema),
});

export type ValidationAnswer = z.infer<typeof validationAnswerSchema>;

/** What a refused save or deploy carries beside its sentence. */
export const refusalIssuesSchema = z.object({
  errors: z.array(issueSchema).optional(),
  warnings: z.array(issueSchema).optional(),
});

/** The warnings a successful save answers with. */
export const savedWarningsSchema = z.object({
  warnings: z.array(issueSchema),
});
