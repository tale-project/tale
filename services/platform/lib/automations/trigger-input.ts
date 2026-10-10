/**
 * The input a trigger hands the run it starts. The builder itself is the
 * engine's (`triggerRunInput` in `lib/engine/core/slots.ts`): the schedule
 * scan, the event dispatch and the webhook door start runs with it, the
 * validator checks it, and the trigger editor previews it and starts "Run
 * now" with it, so what a person is shown is what a run receives. This
 * module adds what the host knows about each kind before a run: the sample
 * facts it would start with, and what of them a check before a run may
 * hold against the trigger.
 *
 * A trigger may carry a fixed input — values every run gets. The trigger's
 * own fields (`trigger`, `firedAt`, `event`, `payload`) are set over it, so
 * a fixed input can never pretend to be a different trigger.
 *
 * Pure: no clock, no I/O — the app bundles it.
 */

import {
  type TriggerFacts,
  type TriggerInputSample,
  type TriggerKind,
  triggerRunInput,
} from '../engine/core/slots.ts';
import {
  EVENT_PAYLOAD_EXAMPLES,
  type EventType,
  isEmittedEventType,
} from '../shared/event-types.ts';

export { TRIGGER_WRAPPER_KEYS } from '@tale/shared/schemas/automation-trigger';
export { type TriggerFacts, type TriggerKind, triggerRunInput };

/** The payload a sample webhook delivery carries, here and in the
 * editor's preview, its curl example and Run now. */
export const SAMPLE_WEBHOOK_PAYLOAD: Readonly<Record<string, unknown>> = {
  example: true,
};

/**
 * The facts a trigger of `kind` would start a run with, before it has:
 * a schedule firing at `now`, a webhook delivering
 * {@link SAMPLE_WEBHOOK_PAYLOAD}, an event carrying its example payload.
 * Null for an event trigger that names no event yet — there is nothing to
 * sample.
 */
export function sampleTriggerFacts(
  kind: TriggerKind,
  options: { now: number; event?: EventType | null },
): TriggerFacts | null {
  switch (kind) {
    case 'schedule':
      return { kind, firedAt: options.now };
    case 'webhook':
      return { kind, payload: { ...SAMPLE_WEBHOOK_PAYLOAD } };
    case 'event':
      return options.event
        ? {
            kind,
            event: options.event,
            payload: EVENT_PAYLOAD_EXAMPLES[options.event],
          }
        : null;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function isTriggerKind(value: string): value is TriggerKind {
  return value === 'schedule' || value === 'webhook' || value === 'event';
}

/**
 * What a trigger would start a run with, for a check before any run — the
 * store's answer to the validator's `triggerInput` seam, and what a save and
 * a deploy check against the version that runs. A webhook's body is unknown
 * until a delivery comes, so a problem inside `payload` is not held against
 * it; a problem at the top — a required field the fixed input lacks, a
 * `payload` the inputs do not take — is. An event's payload is known, so
 * nothing is set aside. Null for a kind the host does not start, or an event
 * trigger that names no event the platform raises.
 */
export function triggerInputSample(
  trigger: {
    kind: string;
    event?: string | null;
    input?: Readonly<Record<string, unknown>> | null;
  },
  now: number,
): TriggerInputSample | null {
  if (!isTriggerKind(trigger.kind)) return null;
  const event =
    trigger.event !== undefined &&
    trigger.event !== null &&
    isEmittedEventType(trigger.event)
      ? trigger.event
      : null;
  const facts = sampleTriggerFacts(trigger.kind, { now, event });
  if (facts === null) return null;
  const fixedInput = trigger.input ?? null;
  return {
    kind: trigger.kind,
    input: triggerRunInput(facts, fixedInput),
    ignorePointers: trigger.kind === 'webhook' ? ['/payload'] : [],
    fixedInput,
  };
}
