import { describe, expect, test } from 'bun:test';

import { parseHint, parseThreadEvent } from '../../src/api/realtime.ts';

describe('parseHint', () => {
  test('reads entity and id of a hint', () => {
    expect(
      parseHint({
        event: 'hint',
        id: '42',
        data: '{"entity":"task","entityId":"t1"}',
      }),
    ).toEqual({ entity: 'task', entityId: 't1' });
    expect(
      parseHint({ event: 'hint', data: '{"entity":"notification"}' }),
    ).toEqual({ entity: 'notification', entityId: null });
  });

  test('ignores other events and survives a broken body', () => {
    expect(parseHint({ event: 'heartbeat', data: '' })).toBeNull();
    expect(parseHint({ event: 'hint', data: '{nope' })).toBeNull();
    expect(parseHint({ event: 'hint', data: '{"entityId":"x"}' })).toBeNull();
  });
});

describe('parseThreadEvent', () => {
  test('progress carries the message id and the text so far', () => {
    expect(
      parseThreadEvent({
        event: 'progress',
        data: JSON.stringify({
          messageId: 'm1',
          text: 'Hel',
          reasoning: '',
          cancelRequested: false,
          serverNow: 1,
        }),
      }),
    ).toEqual({
      kind: 'progress',
      messageId: 'm1',
      text: 'Hel',
      cancelRequested: false,
    });
  });

  test('settled reads the final message, failed when it carries an error', () => {
    expect(
      parseThreadEvent({
        event: 'settled',
        data: JSON.stringify({
          message: { id: 'm1', role: 'assistant', status: 'cancelled' },
        }),
      }),
    ).toEqual({
      kind: 'settled',
      messageId: 'm1',
      status: 'cancelled',
      failed: false,
    });
    expect(
      parseThreadEvent({
        event: 'settled',
        data: JSON.stringify({ message: { id: 'm2', error: 'provider 429' } }),
      }),
    ).toMatchObject({ kind: 'settled', failed: true });
  });

  test('idle, heartbeat and the unknown', () => {
    expect(parseThreadEvent({ event: 'idle', data: '' })).toEqual({
      kind: 'idle',
    });
    expect(parseThreadEvent({ event: 'heartbeat', data: '' })).toEqual({
      kind: 'heartbeat',
    });
    expect(parseThreadEvent({ event: 'progress', data: 'not json' })).toEqual({
      kind: 'other',
      event: 'progress',
    });
    expect(parseThreadEvent({ event: 'surprise', data: '' })).toEqual({
      kind: 'other',
      event: 'surprise',
    });
  });
});
