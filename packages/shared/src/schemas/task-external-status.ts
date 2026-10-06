/** External business systems declare their own actions. Tale renders the
 * established settings controls and records intent; the source owns approval. */
import safeRegex from 'safe-regex2';
import { z } from 'zod/v4';

import { settingsFieldSchema, settingsFormSchema } from './automation-settings';

export const taskLifecycleRevisionSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/);
/** Business records need longer notes and active staff choices than automation
 * settings. The maintained field rules remain intact; their own limits do not
 * change. A whole declaration is bounded as well as each individual field. */
export const externalStatusFieldSchema = settingsFieldSchema
  .safeExtend({
    key: settingsFieldSchema.shape.key.max(64),
    default: z.string().max(4000).optional(),
    options: z
      .array(settingsFieldSchema.shape.options.unwrap().element)
      .min(1)
      .max(1000)
      .optional(),
    multiline: z.boolean().optional(),
  })
  .refine((field) => field.multiline !== true || field.type === 'text', {
    message: 'only text fields may be multiline',
  });
export const externalStatusActionSchema = settingsFormSchema
  .omit({ file: true, required: true, fields: true })
  .extend({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    status: z.enum([
      'backlog',
      'todo',
      'in_progress',
      'in_review',
      'done',
      'cancelled',
    ]),
    fields: z.array(externalStatusFieldSchema).max(30).default([]),
  })
  .strict()
  .refine(
    (action) =>
      new Set(action.fields.map((field) => field.key)).size ===
      action.fields.length,
    { message: 'field keys must be unique' },
  )
  .refine(
    (action) =>
      action.fields.every(
        (field) =>
          !['move', '__proto__', 'prototype', 'constructor'].includes(
            field.key,
          ),
      ),
    { message: 'field key is reserved' },
  )
  .refine(
    (action) =>
      action.fields.every(
        (field) => field.pattern === undefined || safeRegex(field.pattern),
      ),
    { message: 'field pattern must be safe to execute' },
  );

export const externalStatusWorkflowSchema = z
  .strictObject({
    actions: z.array(externalStatusActionSchema).max(16),
  })
  .refine(
    (workflow) =>
      new Set(workflow.actions.map((action) => action.id)).size ===
      workflow.actions.length,
    { message: 'action ids must be unique' },
  )
  .refine(
    (workflow) =>
      new TextEncoder().encode(JSON.stringify(workflow)).byteLength <= 262144,
    { message: 'source workflow must not exceed 256 KiB' },
  );
export type ExternalStatusWorkflow = z.infer<
  typeof externalStatusWorkflowSchema
>;
export type ExternalStatusAction = z.infer<typeof externalStatusActionSchema>;

export const externalStatusRequestBodySchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: taskLifecycleRevisionSchema,
  expectedSourceRevision: z.string().min(1).max(512),
  actionId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  values: z
    .record(z.string().max(64), z.string().max(4000))
    .refine((values) => Object.keys(values).length <= 30),
});
export type ExternalStatusRequestInput = z.infer<
  typeof externalStatusRequestBodySchema
>;

export const externalStatusDecisionSchema = z
  .strictObject({
    accepted: z.boolean(),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((decision) => decision.accepted || decision.reason !== undefined, {
    message: 'a refusal must explain why',
  });
export type ExternalStatusDecision = z.infer<
  typeof externalStatusDecisionSchema
>;

/** Only declared fields reach the source; numbers and booleans use their
 * actual JSON type, while optional blank fields remain absent. */
export function externalStatusRequestValues(
  action: ExternalStatusAction,
  values: Record<string, string>,
): Record<string, string | number | boolean> {
  if (
    Object.keys(values).some(
      (key) => !action.fields.some((field) => field.key === key),
    )
  )
    throw new Error('Unknown source request field');
  const input: Record<string, string | number | boolean> = { move: action.id };
  for (const field of action.fields) {
    const value = (values[field.key] ?? '').trim();
    if (value === '') {
      if (field.required === true)
        throw new Error(`Required source request field: ${field.key}`);
      continue;
    }
    if (field.type === 'boolean') {
      if (value !== 'true' && value !== 'false')
        throw new Error(`Invalid boolean field: ${field.key}`);
      input[field.key] = value === 'true';
    } else if (field.type === 'number') {
      if (!Number.isFinite(Number(value)))
        throw new Error(`Invalid number field: ${field.key}`);
      input[field.key] = Number(value);
    } else {
      if (
        field.type === 'select' &&
        !field.options?.some((option) => option.value === value)
      )
        throw new Error(`Invalid choice field: ${field.key}`);
      if (field.pattern !== undefined && !new RegExp(field.pattern).test(value))
        throw new Error(`Invalid text field: ${field.key}`);
      input[field.key] = value;
    }
  }
  return input;
}
