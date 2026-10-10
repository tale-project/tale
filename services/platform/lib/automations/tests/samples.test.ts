// @vitest-environment node

/**
 * A test written from a trigger holds the input that trigger hands a run,
 * at one fixed moment: the same input every time, whatever the clock says.
 */

import { describe, expect, it } from 'vitest';

import { EVENT_PAYLOAD_EXAMPLES } from '../../shared/event-types';
import { SAMPLE_WEBHOOK_PAYLOAD, triggerRunInput } from '../trigger-input';
import { TEST_SAMPLE_EPOCH, triggerTestInput } from './samples';

describe('triggerTestInput', () => {
  it('fires a schedule on a Monday at nine in the morning, UTC', () => {
    const at = new Date(TEST_SAMPLE_EPOCH);
    expect(at.toISOString()).toBe('2026-01-05T09:00:00.000Z');
    expect(at.getUTCDay()).toBe(1);
    expect(triggerTestInput({ kind: 'schedule' })).toEqual({
      trigger: 'schedule',
      firedAt: TEST_SAMPLE_EPOCH,
    });
  });

  it('delivers the sample webhook payload', () => {
    expect(triggerTestInput({ kind: 'webhook' })).toEqual({
      trigger: 'webhook',
      payload: SAMPLE_WEBHOOK_PAYLOAD,
    });
  });

  it('carries the example payload of the event, as the trigger would', () => {
    const facts = {
      kind: 'event' as const,
      event: 'task.created' as const,
      payload: EVENT_PAYLOAD_EXAMPLES['task.created'],
    };
    expect(triggerTestInput({ kind: 'event', event: 'task.created' })).toEqual(
      JSON.parse(JSON.stringify(triggerRunInput(facts))),
    );
  });

  it("keeps the trigger's fixed input under the trigger's own fields", () => {
    expect(
      triggerTestInput({
        kind: 'schedule',
        input: { region: 'eu', trigger: 'manual', firedAt: 1 },
      }),
    ).toEqual({
      region: 'eu',
      trigger: 'schedule',
      firedAt: TEST_SAMPLE_EPOCH,
    });
  });

  it('has nothing to sample for an event trigger without an event the platform raises', () => {
    expect(triggerTestInput({ kind: 'event' })).toBeNull();
    expect(triggerTestInput({ kind: 'event', event: null })).toBeNull();
    expect(
      triggerTestInput({ kind: 'event', event: 'never.raised' }),
    ).toBeNull();
  });

  it('has nothing to sample for a kind no trigger starts', () => {
    expect(triggerTestInput({ kind: 'api-key' })).toBeNull();
  });

  it('answers plain JSON, the same every time', () => {
    const first = triggerTestInput({ kind: 'event', event: 'task.created' });
    expect(triggerTestInput({ kind: 'event', event: 'task.created' })).toEqual(
      first,
    );
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
});
