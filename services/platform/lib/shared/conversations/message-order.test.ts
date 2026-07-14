import { describe, expect, it } from 'vitest';

import {
  compareConversationMessages,
  type ConversationMessageSortable,
  getConversationMessageSortTime,
  nextConversationLastMessageAt,
} from './message-order';

describe('getConversationMessageSortTime', () => {
  it('prefers sentAt over deliveredAt and _creationTime', () => {
    expect(
      getConversationMessageSortTime({
        _id: 'a',
        _creationTime: 100,
        sentAt: 300,
        deliveredAt: 200,
      }),
    ).toBe(300);
  });

  it('falls back to deliveredAt then _creationTime', () => {
    expect(
      getConversationMessageSortTime({
        _id: 'a',
        _creationTime: 100,
        deliveredAt: 200,
      }),
    ).toBe(200);

    expect(
      getConversationMessageSortTime({
        _id: 'a',
        _creationTime: 100,
      }),
    ).toBe(100);
  });
});

describe('nextConversationLastMessageAt', () => {
  it('uses sentAt for the indexed cursor, not ingestion time', () => {
    const historicalSentAt = 1_752_315_109_000;
    const ingestionTime = 1_752_406_800_000;

    expect(
      nextConversationLastMessageAt(undefined, {
        _id: 'msg',
        _creationTime: ingestionTime,
        sentAt: historicalSentAt,
        deliveredAt: historicalSentAt,
      }),
    ).toBe(historicalSentAt);
  });

  it('never moves the cursor backward on out-of-order sync', () => {
    const current = 1_752_406_542_000;

    expect(
      nextConversationLastMessageAt(current, {
        _id: 'older',
        _creationTime: 1_752_406_800_000,
        sentAt: 1_752_315_109_000,
      }),
    ).toBe(current);
  });

  it('advances the cursor when a newer message arrives', () => {
    const current = 1_752_315_109_000;
    const newer = 1_752_406_542_000;

    expect(
      nextConversationLastMessageAt(current, {
        _id: 'newer',
        _creationTime: newer,
        sentAt: newer,
      }),
    ).toBe(newer);
  });
});

describe('compareConversationMessages', () => {
  it('orders by sentAt when deliveredAt would scramble the thread', () => {
    const messages: ConversationMessageSortable[] = [
      {
        _id: 'inbound_latest',
        _creationTime: 4,
        sentAt: 1_752_406_542_000,
        deliveredAt: 1_752_406_542_000,
      },
      {
        _id: 'outbound_mid',
        _creationTime: 2,
        sentAt: 1_752_405_895_085,
      },
      {
        _id: 'outbound_early',
        _creationTime: 1,
        sentAt: 1_752_405_527_413,
      },
      {
        _id: 'inbound_yesterday',
        _creationTime: 3,
        sentAt: 1_752_315_109_000,
        deliveredAt: 1_752_315_109_000,
      },
    ];

    const sorted = [...messages].sort(compareConversationMessages);

    expect(sorted.map((m) => m._id)).toEqual([
      'inbound_yesterday',
      'outbound_early',
      'outbound_mid',
      'inbound_latest',
    ]);
  });

  it('tie-breaks on _id when sort times are equal', () => {
    const a = { _id: 'b', _creationTime: 100, sentAt: 200 };
    const b = { _id: 'a', _creationTime: 100, sentAt: 200 };

    expect(compareConversationMessages(a, b)).toBeGreaterThan(0);
    expect(compareConversationMessages(b, a)).toBeLessThan(0);
  });
});
