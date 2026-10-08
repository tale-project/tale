/**
 * The input a trigger hands the run it starts, built in one place: the
 * schedule scan, the event dispatch and the webhook door start runs with
 * it, and the trigger editor previews it and starts "Run now" with it, so
 * what a person is shown is what a run receives.
 *
 * A trigger may carry a fixed input — values every run gets. The trigger's
 * own fields (`trigger`, `firedAt`, `event`, `payload`) are set over it, so
 * a fixed input can never pretend to be a different trigger. Without a
 * fixed input the object is exactly the one each door built by hand before:
 * the same keys in the same order, an event's absent payload included.
 *
 * Pure: no clock, no I/O, and Ajv only as a type — the app bundles it.
 */

import type { ErrorObject } from 'ajv';

import {
  EVENT_PAYLOAD_EXAMPLES,
  type EventType,
} from '../shared/event-types.ts';

/** The fields a trigger sets itself; a fixed input may not name them. */
export const TRIGGER_WRAPPER_KEYS = [
  'trigger',
  'firedAt',
  'event',
  'payload',
] as const;

export type TriggerKind = 'schedule' | 'webhook' | 'event';

/** What a trigger knows when it starts a run. */
export type TriggerFacts =
  | { kind: 'schedule'; firedAt: number }
  | { kind: 'webhook'; payload: unknown }
  | { kind: 'event'; event: EventType; payload: unknown };

/** The payload a sample webhook delivery carries, here and in the
 * editor's preview, its curl example and Run now. */
export const SAMPLE_WEBHOOK_PAYLOAD: Readonly<Record<string, unknown>> = {
  example: true,
};

/**
 * The one input a trigger hands its run: the fixed input, with the
 * trigger's own fields over it. `firedAt` is the occurrence a schedule
 * started for, not the moment it ran.
 */
export function triggerRunInput(
  facts: TriggerFacts,
  staticInput?: Readonly<Record<string, unknown>> | null,
): Record<string, unknown> {
  let wrapper: Record<string, unknown>;
  switch (facts.kind) {
    case 'schedule':
      wrapper = { trigger: 'schedule', firedAt: facts.firedAt };
      break;
    case 'event':
      wrapper = {
        trigger: 'event',
        event: facts.event,
        payload: facts.payload,
      };
      break;
    case 'webhook':
      wrapper = { trigger: 'webhook', payload: facts.payload };
      break;
    default: {
      const exhaustive: never = facts;
      return exhaustive;
    }
  }
  return staticInput ? { ...staticInput, ...wrapper } : wrapper;
}

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

/** A compiled inputs check, shaped like Ajv's `ValidateFunction`. */
export interface InputsCheck {
  (input: unknown): boolean;
  errors?: ErrorObject[] | null;
}

/**
 * What an automation's compiled `inputs` check refuses in the input this
 * trigger would hand it, as Ajv's problems (describe them for a reader with
 * `describeSchemaErrors`). A webhook's body is unknown until a delivery
 * comes, so a problem inside `payload` is not held against it; a problem
 * at the top — a required field the fixed input lacks, a `payload` the
 * inputs do not take — is. An event's payload is known, so nothing is
 * dropped.
 */
export function triggerInputIssues(
  check: InputsCheck,
  facts: TriggerFacts,
  staticInput?: Readonly<Record<string, unknown>> | null,
): ErrorObject[] {
  if (check(triggerRunInput(facts, staticInput))) return [];
  const errors = check.errors ?? [];
  if (facts.kind !== 'webhook') return [...errors];
  return errors.filter(
    (error) =>
      error.instancePath !== '/payload' &&
      !error.instancePath.startsWith('/payload/'),
  );
}
