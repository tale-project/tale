/**
 * Native backend for the `notify` platform connector — a message from an
 * automation step to members of the organization: a row in each one's bell,
 * and an email, with the step's title, words and link in a frame that names
 * the automation.
 *
 * Only an automation run's step may send one. The frame names the run's
 * automation, the run's cap bounds what it sends, and `run-starter` means
 * the run's own starter — all read from the run (`caller.runId`), never from
 * the input. A recipient who is not a member fails the whole step before
 * anything is sent: a message never quietly misses someone it names.
 */

import { z } from 'zod';

import type { FailureCause } from '../../engine/core/record/failure';
import {
  classifyMessageLink,
  MESSAGE_LINK_MAX_LENGTH,
} from '../../shared/notifications/message-link';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError } from '../errors';

/** The recipient that names whoever started the run. */
export const RUN_STARTER = 'run-starter';

/** The most messages one run sends, across all its steps. */
export const NOTIFY_RUN_CAP = 100;

/** A member the message reached — now, or on an earlier try of the step. */
export interface NotifiedMember {
  /** The recipient as the step named them. */
  to: string;
  userId: string;
}

/** A recipient the message skipped, and why. */
export interface SkippedRecipient {
  to: string;
  /** Absent when the recipient names nobody (`no_starter`). */
  userId?: string;
  /** `preference`: they switched off messages from automations.
   * `no_starter`: `run-starter` on a run no person started. */
  reason: 'preference' | 'no_starter';
}

/** Why a message was not sent. */
export type NotifyRefusal =
  /** These recipients are not members of the organization. */
  | { kind: 'not_a_member'; recipients: string[] }
  /** Sending would take the run past its cap; `sent` is what it sent before. */
  | { kind: 'run_limit'; limit: number; sent: number }
  /** The run is gone. */
  | { kind: 'no_run' };

/** What the rim needs from the platform's notification domain. */
export interface WorkflowNotifyStore {
  notify(args: {
    organizationId: string;
    runId: string;
    /** The step execution's ledger key: a retry sends nothing twice. */
    idempotencyKey: string;
    to: string[];
    title: string;
    message?: string;
    /** A page of the organization (normalized path) or an https address. */
    link?: string;
  }): Promise<
    | { ok: true; delivered: NotifiedMember[]; skipped: SkippedRecipient[] }
    | { ok: false; refusal: NotifyRefusal }
  >;
}

/** Blank is absent: a template that rendered to nothing names nothing. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === '' ? undefined : value,
    );

const memberInput = z
  .object({
    to: z.array(z.string().trim().min(1).max(320)).min(1).max(20),
    // One line: a title is the bell's heading and the email's subject.
    title: z
      .string()
      .transform((value) => value.replaceAll(/\s+/g, ' ').trim())
      .pipe(z.string().min(1).max(120)),
    message: optionalText(2000),
    link: optionalText(MESSAGE_LINK_MAX_LENGTH),
  })
  .strict();

/** A refusal that knows its cause in the run record's words. */
class NotifyRefusalError extends ConnectorError {
  readonly failure: FailureCause;

  constructor(message: string, failure: FailureCause, hint: string) {
    super('LIVE_BODY_FAILED', message, {
      connector: 'notify',
      action: 'member',
      hint,
    });
    this.failure = failure;
  }
}

function refused(refusal: NotifyRefusal): ConnectorError {
  if (refusal.kind === 'not_a_member') {
    const [first = ''] = refusal.recipients;
    return new NotifyRefusalError(
      `notify.member sent nothing: not members of this organization: ${refusal.recipients.join(', ')}`,
      { reason: 'NOTIFY_NOT_A_MEMBER', params: { recipient: first } },
      'name members by their email or user id, or remove the ones who left',
    );
  }
  if (refusal.kind === 'run_limit') {
    return new NotifyRefusalError(
      `notify.member sent nothing: the run has sent ${refusal.sent} of its ${refusal.limit} messages, and this step would pass that`,
      { reason: 'NOTIFY_RUN_LIMIT', params: { limit: refusal.limit } },
      'send one message to several members instead of one per item',
    );
  }
  return new ConnectorError(
    'LIVE_BODY_FAILED',
    'The run no longer exists, so there is nothing to send its message as',
    { connector: 'notify', action: 'member' },
  );
}

/** The run a message is sent as: only an automation run's step has one. */
function runIdOf(ctx: NativeConnectorContext): string {
  if (ctx.caller?.kind !== 'workflow') {
    throw new ConnectorError(
      'CALLER_UNKNOWN',
      'notify.member sends as an automation run, and this call is not a step of one',
      { connector: 'notify', action: 'member' },
    );
  }
  return ctx.caller.runId;
}

export function notifyNatives(
  store: WorkflowNotifyStore,
): Record<'notify.member', NativeConnectorImpl> {
  return {
    'notify.member': async (raw, ctx) => {
      const parsed = memberInput.safeParse(raw);
      if (!parsed.success) {
        throw new ConnectorError(
          'INPUT_INVALID',
          `notify.member input is invalid: ${parsed.error.issues
            .map(
              (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
            )
            .join('; ')}`,
          { connector: 'notify', action: 'member' },
        );
      }
      const input = parsed.data;
      const runId = runIdOf(ctx);
      let link: string | undefined;
      if (input.link !== undefined) {
        const classified = classifyMessageLink(input.link, ctx.organizationId);
        if (classified === null) {
          throw new ConnectorError(
            'INPUT_INVALID',
            `notify.member input is invalid: link: "${input.link}" is neither a page of this organization (a path such as /tasks/<task id>) nor an https address`,
            { connector: 'notify', action: 'member' },
          );
        }
        link = classified.kind === 'app' ? classified.path : classified.url;
      }
      const answer = await store.notify({
        organizationId: ctx.organizationId,
        runId,
        idempotencyKey: ctx.idempotencyKey,
        to: input.to,
        title: input.title,
        ...(input.message !== undefined && { message: input.message }),
        ...(link !== undefined && { link }),
      });
      if (!answer.ok) throw refused(answer.refusal);
      return { delivered: answer.delivered, skipped: answer.skipped };
    },
  };
}
