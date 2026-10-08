// @vitest-environment node

/**
 * The input a trigger hands its run is built in one place. Without a fixed
 * input it is byte for byte the object each door built by hand; with one,
 * the trigger's own fields win. The inputs check holds a webhook only to
 * what is known before a delivery comes.
 */

import { describe, expect, it } from 'vitest';

import { compileSchema } from '../engine/core/validate/schema.ts';
import { triggerInputWarnings } from '../engine/core/validate/trigger-input.ts';
import { EMITTED_EVENT_TYPES } from '../shared/event-types.ts';
import {
  SAMPLE_WEBHOOK_PAYLOAD,
  sampleTriggerFacts,
  TRIGGER_WRAPPER_KEYS,
  type TriggerFacts,
  triggerInputSample,
  triggerRunInput,
} from './trigger-input.ts';

const FIRED_AT = Date.UTC(2026, 9, 8, 7, 0);

describe('triggerRunInput', () => {
  it('builds exactly the objects the doors built by hand', () => {
    const payload = { orderId: 'ord-1' };
    const cases: [TriggerFacts, Record<string, unknown>][] = [
      [
        { kind: 'schedule', firedAt: FIRED_AT },
        { trigger: 'schedule', firedAt: FIRED_AT },
      ],
      [
        { kind: 'event', event: 'task.created', payload },
        { trigger: 'event', event: 'task.created', payload },
      ],
      [
        { kind: 'event', event: 'contact.created', payload: undefined },
        { trigger: 'event', event: 'contact.created', payload: undefined },
      ],
      [
        { kind: 'webhook', payload: 'plain text' },
        { trigger: 'webhook', payload: 'plain text' },
      ],
    ];
    for (const [facts, literal] of cases) {
      const built = triggerRunInput(facts);
      expect(JSON.stringify(built)).toBe(JSON.stringify(literal));
      expect(Object.keys(built)).toEqual(Object.keys(literal));
      expect(built).toStrictEqual(literal);
    }
  });

  it('sets the trigger fields over a fixed input', () => {
    expect(
      triggerRunInput(
        { kind: 'schedule', firedAt: FIRED_AT },
        { owner: 'tale', repo: 'tale', trigger: 'webhook', firedAt: 1 },
      ),
    ).toEqual({
      owner: 'tale',
      repo: 'tale',
      trigger: 'schedule',
      firedAt: FIRED_AT,
    });
    expect(
      triggerRunInput(
        { kind: 'webhook', payload: { a: 1 } },
        { payload: 'mine' },
      ),
    ).toEqual({ trigger: 'webhook', payload: { a: 1 } });
  });

  it('reads an empty or absent fixed input as none', () => {
    const facts: TriggerFacts = { kind: 'schedule', firedAt: FIRED_AT };
    expect(triggerRunInput(facts, null)).toStrictEqual(triggerRunInput(facts));
    expect(triggerRunInput(facts, {})).toStrictEqual(triggerRunInput(facts));
  });

  it('only ever sets the wrapper keys itself', () => {
    const keys = new Set<string>(TRIGGER_WRAPPER_KEYS);
    for (const facts of [
      { kind: 'schedule', firedAt: 1 },
      { kind: 'webhook', payload: {} },
      { kind: 'event', event: 'task.created', payload: {} },
    ] satisfies TriggerFacts[]) {
      for (const key of Object.keys(triggerRunInput(facts))) {
        expect(keys.has(key), key).toBe(true);
      }
    }
  });
});

describe('sampleTriggerFacts', () => {
  it('samples a schedule at now, a webhook with {example: true}, an event with its example', () => {
    expect(sampleTriggerFacts('schedule', { now: FIRED_AT })).toEqual({
      kind: 'schedule',
      firedAt: FIRED_AT,
    });
    expect(sampleTriggerFacts('webhook', { now: FIRED_AT })).toEqual({
      kind: 'webhook',
      payload: { example: true },
    });
    expect(SAMPLE_WEBHOOK_PAYLOAD).toEqual({ example: true });
    expect(
      sampleTriggerFacts('event', { now: FIRED_AT, event: 'task.created' }),
    ).toMatchObject({
      kind: 'event',
      event: 'task.created',
      payload: { taskId: expect.any(String), projectId: expect.any(String) },
    });
  });

  it('has nothing to sample for an event trigger that names no event', () => {
    expect(sampleTriggerFacts('event', { now: FIRED_AT })).toBeNull();
    expect(
      sampleTriggerFacts('event', { now: FIRED_AT, event: null }),
    ).toBeNull();
  });

  it('hands every emitted event an input an inputs schema can rely on', () => {
    const check = compileSchema({
      type: 'object',
      required: ['trigger', 'event', 'payload'],
      properties: {
        trigger: { const: 'event' },
        event: { type: 'string' },
        payload: { type: 'object' },
      },
    });
    for (const event of EMITTED_EVENT_TYPES) {
      const facts = sampleTriggerFacts('event', { now: FIRED_AT, event });
      expect(facts).not.toBeNull();
      if (facts === null) continue;
      expect(check(triggerRunInput(facts)), event).toBe(true);
    }
  });
});

/** The params of the warnings a trigger's sample earns against `check`. */
function warningsOf(
  check: ReturnType<typeof compileSchema> | null,
  trigger: Parameters<typeof triggerInputSample>[0],
) {
  const sample = triggerInputSample(trigger, FIRED_AT);
  if (sample === null) throw new Error('no sample');
  return triggerInputWarnings(check, sample).map(({ code, params, at }) => ({
    code,
    params,
    at,
  }));
}

describe('triggerInputSample and its warnings [AUTO-R29]', () => {
  const ownerRepo = compileSchema({
    type: 'object',
    required: ['owner', 'repo'],
    properties: { owner: { type: 'string' }, repo: { type: 'string' } },
  });

  it('samples what each kind sends, its fixed input under the trigger fields', () => {
    expect(
      triggerInputSample(
        { kind: 'schedule', input: { owner: 'tale', trigger: 'x' } },
        FIRED_AT,
      ),
    ).toEqual({
      kind: 'schedule',
      input: { owner: 'tale', trigger: 'schedule', firedAt: FIRED_AT },
      ignorePointers: [],
      fixedInput: { owner: 'tale', trigger: 'x' },
    });
    expect(triggerInputSample({ kind: 'webhook' }, FIRED_AT)).toEqual({
      kind: 'webhook',
      input: { trigger: 'webhook', payload: { example: true } },
      ignorePointers: ['/payload'],
      fixedInput: null,
    });
    expect(
      triggerInputSample({ kind: 'event', event: 'no.such.event' }, FIRED_AT),
    ).toBeNull();
    expect(triggerInputSample({ kind: 'api-key' }, FIRED_AT)).toBeNull();
  });

  it('names the fields Ada’s GitHub schedule lacks, and none once its fixed input has them', () => {
    expect(warningsOf(ownerRepo, { kind: 'schedule' })).toEqual([
      {
        code: 'TRIGGER_INPUT_MISMATCH',
        at: { pointer: '/inputs' },
        params: {
          kind: 'schedule',
          missing: ['owner', 'repo'],
          problems: ['owner is required', 'repo is required'],
        },
      },
    ]);
    expect(
      warningsOf(ownerRepo, {
        kind: 'schedule',
        input: { owner: 'tale', repo: 'tale' },
      }),
    ).toEqual([]);
  });

  it('does not hold a webhook to its unknown body, only to what is at the top', () => {
    const orders = compileSchema({
      type: 'object',
      required: ['payload'],
      properties: {
        trigger: { const: 'webhook' },
        payload: {
          type: 'object',
          required: ['orderId'],
          properties: { orderId: { type: 'string' } },
          additionalProperties: false,
        },
      },
    });
    expect(warningsOf(orders, { kind: 'webhook' })).toEqual([]);

    const closed = compileSchema({
      type: 'object',
      required: ['owner'],
      properties: { trigger: { type: 'string' }, owner: { type: 'string' } },
      additionalProperties: false,
    });
    expect(warningsOf(closed, { kind: 'webhook' })).toEqual([
      {
        code: 'TRIGGER_INPUT_MISMATCH',
        at: { pointer: '/inputs' },
        params: {
          kind: 'webhook',
          missing: ['owner'],
          problems: [
            'owner is required',
            'payload is not a field the inputs schema takes',
          ],
        },
      },
    ]);
  });

  it('holds an event to its known payload', () => {
    const needsAssignee = compileSchema({
      type: 'object',
      properties: {
        payload: { type: 'object', required: ['assigneeId'] },
      },
    });
    expect(
      warningsOf(needsAssignee, { kind: 'event', event: 'task.created' }),
    ).toEqual([
      {
        code: 'TRIGGER_INPUT_MISMATCH',
        at: { pointer: '/inputs' },
        params: {
          kind: 'event',
          missing: ['payload.assigneeId'],
          problems: ['payload.assigneeId is required'],
        },
      },
    ]);
  });

  it('names a template in the fixed input, which is plain data — with or without an inputs schema', () => {
    const templated = {
      kind: 'webhook',
      input: {
        owner: '{{ payload.repository.owner }}',
        labels: ['triage', '{{ payload.label }}'],
        repo: 'tale',
      },
    };
    expect(warningsOf(null, templated)).toEqual([
      {
        code: 'TRIGGER_INPUT_NOT_TEMPLATED',
        at: { pointer: '/inputs' },
        params: { paths: ['owner', 'labels.1'] },
      },
    ]);
    expect(warningsOf(ownerRepo, templated).map((w) => w.code)).toEqual([
      'TRIGGER_INPUT_NOT_TEMPLATED',
    ]);
  });
});
