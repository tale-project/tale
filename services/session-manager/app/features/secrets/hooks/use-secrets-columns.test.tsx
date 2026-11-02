import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { describe, expect, it, vi } from 'vitest';

import { renderHookApp } from '@/tests/utils/render';

import {
  SECRETS_TABLE_MIN_WIDTH,
  scopeGrowth,
  useSecretsColumns,
} from './use-secrets-columns';

const columnsOf = (compact: boolean, growth = 0) =>
  renderHookApp(() =>
    useSecretsColumns({
      compact,
      scopeGrowth: growth,
      onView: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    }),
  ).result.current;

const sizeOf = (columns: ReturnType<typeof columnsOf>, id: string) =>
  columns.find((column) => idOf(column) === id)?.size;

/** TanStack's default size: the table reads it as "not set". */
const DEFAULT_SIZE = 150;

type Column = ReturnType<typeof columnsOf>[number];

/** What a column is called: its id, or the key it reads. */
function idOf(column: Column): string {
  if (column.id !== undefined) return column.id;
  return 'accessorKey' in column ? String(column.accessorKey) : '';
}

/** Whether the column takes the slack the table has left (`meta.flex`). */
function takesSlack(column: Column): boolean {
  const { meta } = column;
  return (
    typeof meta === 'object' &&
    meta !== null &&
    'flex' in meta &&
    meta.flex === true
  );
}

describe('the columns of the secrets', () => {
  it('are the title, the type, who it is available to, the details, the age, then the menu of the row', () => {
    expect(columnsOf(false).map(idOf)).toEqual([
      'title',
      'kind',
      'scope',
      'preview',
      'updatedAt',
      'actions',
    ]);
  });

  it("add up to the width the table asks of its column, the menu's included", () => {
    const sizes = columnsOf(false).map((column) => column.size ?? 0);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(
      SECRETS_TABLE_MIN_WIDTH,
    );
    expect(columnsOf(false).at(-1)?.size).toBe(ACTIONS_COLUMN_SIZE);
  });

  it('need no more than a laptop window gives them, so a window of 1024px has no compact row', () => {
    // The page column of a 1024px window: 52px of rail and 16px of margin a side,
    // and on Windows and Linux the 15px of a scrollbar that is not an overlay.
    expect(SECRETS_TABLE_MIN_WIDTH).toBeLessThanOrEqual(1024 - 52 - 32 - 15);
  });

  it('give the age room for the longest phrase a fresh change reads, so that it never runs into the menu of the row', () => {
    // Measured in a browser at the cell's 14px: "il y a quelques secondes" is
    // 163px wide in French, "vor ein paar Sekunden" 149px in German, and a cell
    // pads its text with 12px a side.
    const age = columnsOf(false).find((column) => idOf(column) === 'updatedAt');
    expect(age?.size).toBeGreaterThanOrEqual(163 + 24);
  });

  it('leave no column at the default size, which the table takes for "not set" and gives a share of the slack', () => {
    for (const column of columnsOf(false)) {
      expect(column.size).not.toBe(DEFAULT_SIZE);
    }
  });

  it('leave the slack of a wide window to the details, the one column of prose, and not to the title', () => {
    const flexible = columnsOf(false).filter(takesSlack);
    expect(flexible.map(idOf)).toEqual(['preview']);
  });

  it('are the title and the menu when the column is too narrow for the rest', () => {
    expect(columnsOf(true).map(idOf)).toEqual(['title', 'actions']);
  });

  describe('in a wide table', () => {
    it('are the same columns, with more room for who a secret is available to', () => {
      const narrow = columnsOf(false);
      const wide = columnsOf(false, 46);

      expect(wide.map(idOf)).toEqual(narrow.map(idOf));
      // The name of a session is the person's own text: a normal one ("Competitor research") fits.
      expect(sizeOf(wide, 'scope')).toBe((sizeOf(narrow, 'scope') ?? 0) + 46);
      expect(sizeOf(wide, 'scope')).toBeGreaterThanOrEqual(190);
    });

    it('leave every other column as it is, the age with room for the longest phrase a fresh change reads', () => {
      const narrow = columnsOf(false);
      const wide = columnsOf(false, 46);
      for (const id of ['title', 'kind', 'preview', 'updatedAt', 'actions']) {
        expect(sizeOf(wide, id)).toBe(sizeOf(narrow, id));
      }
      expect(sizeOf(wide, 'updatedAt')).toBeGreaterThanOrEqual(163 + 24);
    });

    it('still leave the details the slack', () => {
      const wide = columnsOf(false, 46);
      expect(wide.filter(takesSlack).map(idOf)).toEqual(['preview']);
    });

    describe('scopeGrowth', () => {
      it('is nothing in a table that has no room to spare, a window of 1024px included', () => {
        expect(scopeGrowth(0)).toBe(0);
        expect(scopeGrowth(1024 - 52 - 32)).toBe(0);
        expect(scopeGrowth(1000)).toBe(0);
      });

      it('grows by half a pixel for each the table has beyond that, up to what a normal name needs', () => {
        expect(scopeGrowth(1020)).toBe(10);
        expect(scopeGrowth(1060)).toBe(30);
        expect(scopeGrowth(1092)).toBe(46);
        expect(scopeGrowth(1400)).toBe(46);
        expect(scopeGrowth(4000)).toBe(46);
      });

      it('never takes from the details what the table gave them a pixel narrower: they only grow with the table', () => {
        const others = (width: number) =>
          columnsOf(false, scopeGrowth(width))
            .filter((column) => !takesSlack(column))
            .reduce((sum, column) => sum + (column.size ?? 0), 0);
        let before = 0;
        for (let width = SECRETS_TABLE_MIN_WIDTH; width <= 2400; width += 1) {
          const details = width - others(width);
          expect(details).toBeGreaterThanOrEqual(before);
          before = details;
        }
      });
    });

    it('leave the compact row as it is', () => {
      expect(columnsOf(true, 46).map(idOf)).toEqual(['title', 'actions']);
      expect(sizeOf(columnsOf(true, 46), 'title')).toBe(
        sizeOf(columnsOf(true), 'title'),
      );
    });
  });
});
