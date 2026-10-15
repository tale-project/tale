/**
 * Native backend for the `automation` platform connector — the place a
 * scheduled automation carries on from between its runs.
 *
 * A digest keeps the end of the window it sent, a triage the last issue
 * change it read: `automation.read_position` answers the place under a key at
 * the start of a run, and `automation.save_position` moves it at the end. The
 * place belongs to the automation the asking run belongs to, in the run's
 * project (or the organization) — read from the run itself (`caller.runId`),
 * never from the input, so a step can only ever read or move its own
 * automation's places. A save hands back the revision its run read and lands
 * only while the place still holds it, so an overlapping run, or one that
 * read before another run saved, never moves the place back.
 */

import { z } from 'zod';

import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError } from '../errors';

/** The revision of a place nothing was saved under yet. */
export const NO_POSITION_REVISION = '0';

/** The most a saved place may weigh, as JSON text. */
export const POSITION_MAX_BYTES = 16 * 1024;

/** What a save answers. */
export interface PositionSave {
  /** The value is now the place. */
  saved: boolean;
  /** Another save moved the place since this run read it; nothing changed. */
  conflict: boolean;
  /** The place's revision now. */
  revision: string;
}

/** What the rim needs from the automations domain's position store. */
export interface WorkflowAutomationPositions {
  read(args: {
    organizationId: string;
    runId: string;
    key: string;
  }): Promise<{ value: unknown; revision: string }>;
  /** Null when the run no longer exists. */
  save(args: {
    organizationId: string;
    runId: string;
    key: string;
    value: unknown;
    revision: string;
  }): Promise<PositionSave | null>;
}

const key = z.string().min(1).max(200);

const readInput = z.object({ key }).strict();

const saveInput = z
  .object({
    key,
    value: z
      .unknown()
      .refine((value) => value !== null && value !== undefined, {
        message: 'is a JSON value other than null',
      })
      .refine(
        (value) =>
          new TextEncoder().encode(JSON.stringify(value)).length <=
          POSITION_MAX_BYTES,
        { message: `is at most ${POSITION_MAX_BYTES} bytes of JSON` },
      ),
    revision: z.string().regex(/^[0-9]{1,19}$/, {
      message: 'is the revision read_position answered in this run',
    }),
  })
  .strict();

function refused(action: string, issues: z.ZodError): never {
  throw new ConnectorError(
    'INPUT_INVALID',
    `automation.${action} input is invalid: ${issues.issues
      .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
      .join('; ')}`,
    { connector: 'automation', action },
  );
}

/** The run a place belongs to: only an automation run's step has one. */
function runIdOf(action: string, ctx: NativeConnectorContext): string {
  if (ctx.caller?.kind !== 'workflow') {
    throw new ConnectorError(
      'CALLER_UNKNOWN',
      `automation.${action} keeps the place of the automation it runs in, and this call is not a step of one`,
      { connector: 'automation', action },
    );
  }
  return ctx.caller.runId;
}

export function platformAutomationNatives(
  store: WorkflowAutomationPositions,
): Record<
  'automation.read_position' | 'automation.save_position',
  NativeConnectorImpl
> {
  return {
    'automation.read_position': async (raw, ctx) => {
      const parsed = readInput.safeParse(raw);
      if (!parsed.success) refused('read_position', parsed.error);
      return store.read({
        organizationId: ctx.organizationId,
        runId: runIdOf('read_position', ctx),
        key: parsed.data.key,
      });
    },
    'automation.save_position': async (raw, ctx) => {
      const parsed = saveInput.safeParse(raw);
      if (!parsed.success) refused('save_position', parsed.error);
      const answer = await store.save({
        organizationId: ctx.organizationId,
        runId: runIdOf('save_position', ctx),
        key: parsed.data.key,
        value: parsed.data.value,
        revision: parsed.data.revision,
      });
      if (answer === null) {
        throw new ConnectorError(
          'LIVE_BODY_FAILED',
          'The run no longer exists, so there is no automation to keep the place of',
          { connector: 'automation', action: 'save_position' },
        );
      }
      return answer;
    },
  };
}
