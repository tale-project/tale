import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { describe, expect, it } from 'vitest';

import { renderHookApp } from '@/tests/utils/render';

import {
  PROXIES_TABLE_MIN_WIDTH,
  useProxiesColumns,
} from './use-proxies-columns';

const columnsOf = (compact: boolean) =>
  renderHookApp(() => useProxiesColumns({ compact })).result.current;

/** TanStack's default size: the table reads it as "not set". */
const DEFAULT_SIZE = 150;

describe('the columns of the proxies', () => {
  it('are one for each thing a proxy says, then the menu of the row', () => {
    expect(columnsOf(false).map((column) => column.id)).toEqual([
      'proxy',
      'exit',
      'ping',
      'health',
      'session',
      'actions',
    ]);
  });

  it("add up to the width the table asks of its column, the menu's included", () => {
    const sizes = columnsOf(false).map((column) => column.size ?? 0);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(
      PROXIES_TABLE_MIN_WIDTH,
    );
    expect(columnsOf(false).at(-1)?.size).toBe(ACTIONS_COLUMN_SIZE);
  });

  it('need no more than a laptop window gives them, so a window of 1024px has no compact row', () => {
    // The page column of a 1024px window: 52px of rail and 16px of margin a side.
    expect(PROXIES_TABLE_MIN_WIDTH).toBeLessThanOrEqual(1024 - 52 - 32);
  });

  it('leave no column at the default size, which the table takes for "not set" and gives a share of the slack', () => {
    for (const column of columnsOf(false)) {
      expect(column.size).not.toBe(DEFAULT_SIZE);
    }
  });

  it('give no column all the slack of a wide window: they grow together, by their sizes', () => {
    for (const column of columnsOf(false)) {
      expect(column.meta).not.toMatchObject({ flex: true });
    }
  });

  it('need no more than the narrowest phone gives the one-column table, which has nowhere to scroll to', () => {
    // A window of 320px, less 16px of margin a side and the 1px border of the table.
    const floor = columnsOf(true).reduce(
      (sum, column) => sum + (column.size ?? 0),
      0,
    );
    expect(floor).toBeLessThanOrEqual(320 - 32 - 2);
  });

  it('are the proxy and the menu when the column is too narrow for the rest', () => {
    expect(columnsOf(true).map((column) => column.id)).toEqual([
      'proxy',
      'actions',
    ]);
  });
});
