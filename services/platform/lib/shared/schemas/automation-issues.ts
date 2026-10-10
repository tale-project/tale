/**
 * The automation issues the app reads off the wire: a draft check's answer
 * (`POST /api/app/automations/:name/validate`), the `errors` and `warnings`
 * a refused save or deploy carries under `data`, and the `warnings` a
 * successful save returns.
 *
 * The engine's own `Issue` (`lib/engine/core/types.ts`) is the source of
 * truth; this schema reads what the editor uses of it, so a malformed or
 * foreign answer is refused at the boundary instead of travelling into the
 * Problems panel as a cast. Fields the editor does not read (`related`, most
 * of the analysis) are left out and stripped. A code is any string: a newer
 * server's code still reads, as a problem this build has no words for.
 *
 * Beside the issues, a check may answer the part of its analysis the canvas
 * reads (why a node can fail, what the result may leave empty) and the
 * inferred shapes of the run input, every node's output and the result. Each
 * is read on its own: a malformed one is dropped, never the issues with it.
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

/** The part of the check's analysis the canvas reads. A failure reason is
 * any string: a newer server's reason reads as no words, not a refusal. */
export const analysisSchema = z.object({
  nodes: z.record(
    z.string(),
    z.object({ failureReasons: z.array(z.string()) }),
  ),
  paths: z.object({
    count: z.number().int().nonnegative(),
    truncated: z.boolean(),
    halts: z.array(
      z.object({ nodeId: z.string(), reasons: z.array(z.string()) }),
    ),
  }),
  output: z.object({ reads: z.array(z.string()), maybeEmpty: z.boolean() }),
});

export type AnalysisView = z.infer<typeof analysisSchema>;

/** A JSON value, as `enum` and `const` hold them. */
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** An inferred shape (the engine's `Shape`, a JSON Schema subset). */
export interface WireShape {
  type?:
    | 'object'
    | 'array'
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'null';
  properties?: Record<string, WireShape>;
  required?: string[];
  additionalProperties?: boolean | WireShape;
  items?: WireShape;
  anyOf?: WireShape[];
  enum?: JsonValue[];
  const?: JsonValue;
  description?: string;
  'x-origin'?: 'declared' | 'signature' | 'inferred' | 'fixed' | 'child';
}

/** Shapes nest this deep before the rest reads as "anything": a
 * pathological answer cannot make the parse recurse without end. */
export const MAX_SHAPE_DEPTH = 16;

const shapeAt = new Map<number, z.ZodType<WireShape>>();

function shapeSchemaAt(depth: number): z.ZodType<WireShape> {
  const known = shapeAt.get(depth);
  if (known !== undefined) return known;
  const schema: z.ZodType<WireShape> =
    depth >= MAX_SHAPE_DEPTH
      ? z.unknown().transform((): WireShape => ({}))
      : z.lazy(() => {
          const inner = shapeSchemaAt(depth + 1);
          return z.object({
            type: z
              .enum([
                'object',
                'array',
                'string',
                'number',
                'integer',
                'boolean',
                'null',
              ])
              .optional(),
            properties: z.record(z.string(), inner).optional(),
            required: z.array(z.string()).optional(),
            additionalProperties: z.union([z.boolean(), inner]).optional(),
            items: inner.optional(),
            anyOf: z.array(inner).optional(),
            enum: z.array(jsonValueSchema).optional(),
            const: jsonValueSchema.optional(),
            description: z.string().optional(),
            'x-origin': z
              .enum(['declared', 'signature', 'inferred', 'fixed', 'child'])
              .optional(),
          });
        });
  shapeAt.set(depth, schema);
  return schema;
}

const shapeSchema = shapeSchemaAt(0);

/** The inferred shapes: the run input, each node's output, the result. */
export const typesSchema = z.object({
  inputs: shapeSchema,
  nodes: z.record(
    z.string(),
    z.object({
      output: shapeSchema,
      item: shapeSchema.optional(),
      input: shapeSchema.optional(),
    }),
  ),
  output: shapeSchema,
});

export type TypesView = z.infer<typeof typesSchema>;

/** What a refused save or deploy carries beside its sentence. */
export const refusalIssuesSchema = z.object({
  errors: z.array(issueSchema).optional(),
  warnings: z.array(issueSchema).optional(),
});

/** The warnings a successful save answers with. */
export const savedWarningsSchema = z.object({
  warnings: z.array(issueSchema),
});
