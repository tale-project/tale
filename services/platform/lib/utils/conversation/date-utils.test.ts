import { describe, expect, it } from 'vitest';

import { groupMessagesByDate } from './date-utils';

describe('groupMessagesByDate', () => {
  it('sorts date groups and messages within each group chronologically', () => {
    const groups = groupMessagesByDate([
      {
        id: 'today_late',
        sender: 'Customer',
        content: 'Late reply',
        timestamp: '2026-07-06T13:35:42.000Z',
        isCustomer: true,
        status: 'delivered',
      },
      {
        id: 'yesterday',
        sender: 'Customer',
        content: 'Yesterday',
        timestamp: '2026-07-05T06:31:49.000Z',
        isCustomer: true,
        status: 'delivered',
      },
      {
        id: 'today_early',
        sender: 'Agent',
        content: 'First reply',
        timestamp: '2026-07-06T11:38:47.413Z',
        isCustomer: false,
        status: 'sent',
      },
      {
        id: 'today_mid',
        sender: 'Agent',
        content: 'Second reply',
        timestamp: '2026-07-06T13:09:55.085Z',
        isCustomer: false,
        status: 'sent',
      },
    ]);

    expect(groups.map((group) => group.messages.map((m) => m.id))).toEqual([
      ['yesterday'],
      ['today_early', 'today_mid', 'today_late'],
    ]);
  });
});
