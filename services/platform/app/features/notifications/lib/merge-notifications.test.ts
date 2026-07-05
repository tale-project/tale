import { describe, expect, it } from 'vitest';

import { mergeNotificationsByRecency } from './merge-notifications';

describe('mergeNotificationsByRecency', () => {
  it('interleaves both streams newest-first across sources (#2377)', () => {
    const personal = [
      { id: 'p-new', createdAt: 300 },
      { id: 'p-old', createdAt: 100 },
    ];
    const org = [
      { id: 'o-mid', createdAt: 200 },
      { id: 'o-oldest', createdAt: 50 },
    ];

    const merged = mergeNotificationsByRecency(personal, org);

    expect(merged.map((e) => `${e.kind}:${e.item.id}`)).toEqual([
      'personal:p-new',
      'org:o-mid',
      'personal:p-old',
      'org:o-oldest',
    ]);
  });

  it('keeps personal before org when timestamps tie (stable order)', () => {
    const personal = [{ id: 'p', createdAt: 100 }];
    const org = [{ id: 'o', createdAt: 100 }];

    const merged = mergeNotificationsByRecency(personal, org);

    expect(merged.map((e) => e.kind)).toEqual(['personal', 'org']);
  });

  it('handles an empty stream on either side', () => {
    expect(
      mergeNotificationsByRecency([], [{ id: 'o', createdAt: 1 }]),
    ).toEqual([{ kind: 'org', item: { id: 'o', createdAt: 1 } }]);
    expect(
      mergeNotificationsByRecency([{ id: 'p', createdAt: 1 }], []),
    ).toEqual([{ kind: 'personal', item: { id: 'p', createdAt: 1 } }]);
  });
});
