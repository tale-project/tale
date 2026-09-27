import { describe, expect, it } from 'vitest';

import {
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
