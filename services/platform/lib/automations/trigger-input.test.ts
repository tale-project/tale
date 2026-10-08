// @vitest-environment node

/**
 * The input a trigger hands its run is built in one place. Without a fixed
 * input it is byte for byte the object each door built by hand; with one,
 * the trigger's own fields win. The inputs check holds a webhook only to
 * what is known before a delivery comes.
 */

import { describe, expect, it } from 'vitest';

import { compileSchema } from '../engine/core/validate/schema.ts';
import { EMITTED_EVENT_TYPES } from '../shared/event-types.ts';
import {
  SAMPLE_WEBHOOK_PAYLOAD,
  sampleTriggerFacts,
  TRIGGER_WRAPPER_KEYS,
  type TriggerFacts,
  triggerInputIssues,
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
      expect(triggerInputIssues(check, facts), event).toEqual([]);
    }
  });
});

describe('triggerInputIssues', () => {
  const ownerRepo = compileSchema({
    type: 'object',
    required: ['owner', 'repo'],
    properties: { owner: { type: 'string' }, repo: { type: 'string' } },
  });

  it('names the required fields a schedule does not send', () => {
    const facts: TriggerFacts = { kind: 'schedule', firedAt: FIRED_AT };
    expect(
      triggerInputIssues(ownerRepo, facts).map((error) => [
        error.keyword,
        error.params,
      ]),
    ).toEqual([
      ['required', { missingProperty: 'owner' }],
      ['required', { missingProperty: 'repo' }],
    ]);
    expect(
      triggerInputIssues(ownerRepo, facts, { owner: 'tale', repo: 'tale' }),
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
    const webhook: TriggerFacts = {
      kind: 'webhook',
      payload: { example: true },
    };
    expect(triggerInputIssues(orders, webhook)).toEqual([]);

    const closed = compileSchema({
      type: 'object',
      required: ['owner'],
      properties: { trigger: { type: 'string' }, owner: { type: 'string' } },
      additionalProperties: false,
    });
    expect(
      triggerInputIssues(closed, webhook).map((error) => [
        error.instancePath,
        error.keyword,
        error.params,
      ]),
    ).toEqual([
      ['', 'required', { missingProperty: 'owner' }],
      ['', 'additionalProperties', { additionalProperty: 'payload' }],
    ]);
  });

  it('holds an event to its known payload', () => {
    const needsAssignee = compileSchema({
      type: 'object',
      properties: {
        payload: { type: 'object', required: ['assigneeId'] },
      },
    });
    const facts = sampleTriggerFacts('event', {
      now: FIRED_AT,
      event: 'task.created',
    });
    expect(facts).not.toBeNull();
    if (facts === null) return;
    expect(
      triggerInputIssues(needsAssignee, facts).map(
        (error) => error.instancePath,
      ),
    ).toEqual(['/payload']);
  });
});
