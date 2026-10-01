import { describe, expect, it } from 'vitest';

import { readableNotificationParams } from './notification-params';

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
  in_review: 'In review',
};
const label = (status: string) => STATUS_LABELS[status];

describe('readableNotificationParams', () => {
  it('names task statuses the way the board does', () => {
    expect(
      readableNotificationParams(
        { title: 'Compare the offers', from: 'in_progress', to: 'in_review' },
        label,
      ),
    ).toEqual({
      title: 'Compare the offers',
      from: 'In progress',
      to: 'In review',
    });
  });

  it('leaves a from/to that is not a status as it was written', () => {
    expect(
      readableNotificationParams({ from: 'Alex', to: 'Sam' }, label),
    ).toEqual({ from: 'Alex', to: 'Sam' });
  });

  it('never maps a status id outside from/to', () => {
    expect(readableNotificationParams({ title: 'in_review' }, label)).toEqual({
      title: 'in_review',
    });
  });

  it('passes every other value through untouched, null included', () => {
    // A value the formatter names but cannot find sends the WHOLE message
    // back to its raw template; a null reads as empty.
    const params = {
      failures: 5,
      projectId: 'proj-1',
      budgets: true,
      reason: null,
      nested: { a: 1 },
    };
    expect(readableNotificationParams(params, label)).toEqual(params);
  });

  it('passes an absent bag through', () => {
    expect(readableNotificationParams(undefined, label)).toBeUndefined();
    expect(readableNotificationParams(null, label)).toBeUndefined();
  });
});
