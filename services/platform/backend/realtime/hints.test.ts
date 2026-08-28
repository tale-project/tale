import { describe, expect, it } from 'vitest';

import { coalesceHints } from './hints.ts';

interface Row {
  id: string;
  entity: string;
  entityId: string | null;
}

const row = (id: string, entity: string, entityId: string | null): Row => ({
  id,
  entity,
  entityId,
});

describe('coalesceHints', () => {
  it('keeps the last occurrence per (entity, entityId) in ascending order', () => {
    const rows = [
      row('1', 'task', 'a'),
      row('2', 'task', 'b'),
      row('3', 'task', 'a'),
      row('4', 'notification', null),
      row('5', 'task', 'a'),
    ];
    expect(coalesceHints(rows)).toEqual([
      row('2', 'task', 'b'),
      row('4', 'notification', null),
      row('5', 'task', 'a'),
    ]);
  });

  it('treats null entityId as distinct from the string "null"', () => {
    const rows = [row('1', 'task', null), row('2', 'task', 'null')];
    expect(coalesceHints(rows)).toEqual(rows);
  });

  it('returns an empty array unchanged', () => {
    expect(coalesceHints([])).toEqual([]);
  });
});
