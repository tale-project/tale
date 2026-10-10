import { z } from 'zod';

import { REPLAY_KINDS } from '../automation-replay';

/**
 * What running an automation run again asks for, as every door takes it —
 * the app, REST and the agent tools: how (`again` with the run's own input,
 * `edited` with an input the person changed, `from` one of its steps, a
 * fork that keeps what the run finished outside that step and what it
 * feeds), which version (the run's own by default), in which mode (the
 * run's own by default), and, for `edited`, the input.
 */

/** The request's fields, for a door that adds its own beside them. */
export const replayRequestFields = {
  kind: z.enum(REPLAY_KINDS),
  from: z.string().trim().min(1).max(200).optional(),
  version: z
    .union([
      z.enum(['same', 'deployed', 'latest']),
      z.number().int().min(1).max(1_000_000),
    ])
    .optional(),
  mode: z.enum(['mock', 'live']).optional(),
  input: z.unknown().optional(),
};

export type ReplayRequestShape = z.infer<
  z.ZodObject<typeof replayRequestFields>
>;

/** The rules between the fields: a fork names its step and only a fork
 * does; an edited replay carries its input and only it does. */
export function checkReplayRequest(
  value: ReplayRequestShape,
  ctx: z.RefinementCtx,
): void {
  if (value.kind === 'from' && value.from === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: 'names the step to run again from',
    });
  }
  if (value.kind !== 'from' && value.from !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: 'is taken only by a replay from a step (kind "from")',
    });
  }
  if (value.kind === 'edited' && !('input' in value)) {
    ctx.addIssue({
      code: 'custom',
      path: ['input'],
      message: 'is the input an edited replay runs with',
    });
  }
  if (value.kind !== 'edited' && value.input !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['input'],
      message:
        'is taken only by an edited replay (kind "edited"); the others run with the run’s own input',
    });
  }
}

export const replayRequestSchema = z
  .strictObject(replayRequestFields)
  .superRefine(checkReplayRequest);

export type ReplayRequestBody = z.infer<typeof replayRequestSchema>;

/** The app's request: the same, with a nonce so a double click starts one
 * replay. */
export const appReplayRequestSchema = z
  .strictObject({
    ...replayRequestFields,
    requestId: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine(checkReplayRequest);
