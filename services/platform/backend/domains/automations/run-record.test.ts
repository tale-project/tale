// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { eventView } from './run-record.ts';

describe('eventView', () => {
  it('answers where, why and who decided — never the process that saw it [AUTO-R40]', () => {
    expect(
      eventView({
        id: 'ev-1',
        at: 5,
        kind: 'in_doubt_resolved',
        detail: {
          path: 'save',
          itemIndex: 2,
          pass: 0,
          reason: 'lease_expired',
          resolution: 'skip',
          resolvedBy: 'user-1',
          instance: 'host:1:v1:blue',
          release: '0.5.70',
        },
      }),
    ).toEqual({
      id: 'ev-1',
      at: 5,
      kind: 'in_doubt_resolved',
      nodeId: 'save',
      itemIndex: 2,
      pass: 0,
      reason: 'lease_expired',
      resolution: 'skip',
      by: 'user-1',
    });
    expect(
      eventView({ id: 'ev-2', at: 6, kind: 'taken_over', detail: 'text' }),
    ).toEqual({ id: 'ev-2', at: 6, kind: 'taken_over' });
    expect(
      eventView({
        id: 'ev-3',
        at: 7,
        kind: 'in_doubt_resolved',
        detail: { resolution: 'drop tables' },
      }),
    ).toEqual({ id: 'ev-3', at: 7, kind: 'in_doubt_resolved' });
  });
});
