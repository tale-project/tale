// @vitest-environment node

/**
 * The transcript reads one page at a time: its newest rows first, then the
 * page before the cursor the previous page answered — never the whole
 * thread. The keyset is the threads store's; this lane adds the caller's
 * organization, every role and the view's own columns.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  listMessageViewsPage,
  MESSAGE_VIEW_PAGE_SIZE,
} from './message-views.ts';

interface Row {
  id: string;
  role: string;
  order: number;
  stepOrder: number;
}

/** A `sql` answering the page read with `rows`, newest first as the keyset
 * orders them, and recording each statement with its values. */
function fakeSql(rows: Row[]): {
  sql: Sql;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(
      rows.map((row) => ({
        id: row.id,
        role: row.role,
        parts: [{ type: 'text', text: row.id }],
        sequence: row.order,
        model: row.role === 'assistant' ? 'gpt-x' : null,
        providerSlug: null,
        usage: null,
        blockedReason: null,
        error: null,
        status: 'complete',
        createdAt: row.order,
        order: row.order,
        stepOrder: row.stepOrder,
      })),
    );
  };
  Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `unsafe` are exercised
  return { sql: tag as unknown as Sql, calls };
}

describe('listMessageViewsPage', () => {
  it('reads the newest page of every role in the caller’s organization', async () => {
    const { sql, calls } = fakeSql([
      { id: 'm-3', role: 'assistant', order: 2, stepOrder: 1 },
      { id: 'm-2', role: 'tool', order: 2, stepOrder: 0 },
      { id: 'm-1', role: 'user', order: 1, stepOrder: 0 },
    ]);

    const page = await listMessageViewsPage(sql, 'org-1', 't-1');

    expect(page.messages.map((row) => row.id)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(page.hasMore).toBe(false);
    expect(page.nextBefore).toBeNull();
    const [call] = calls;
    expect(calls).toHaveLength(1);
    // [columns, thread, org clause on, org, no cursor, order, step,
    //  every role, page size + 1]
    expect(call?.values.slice(1)).toEqual([
      't-1',
      false,
      'org-1',
      true,
      0,
      0,
      true,
      MESSAGE_VIEW_PAGE_SIZE + 1,
    ]);
    expect(call?.values[0]).toContain('blocked_reason AS "blockedReason"');
    expect(call?.values[0]).toContain('step_order AS "stepOrder"');
  });

  it('answers the view shape, without the keyset columns it paged on', async () => {
    const { sql } = fakeSql([
      { id: 'm-2', role: 'assistant', order: 4, stepOrder: 2 },
    ]);

    const page = await listMessageViewsPage(sql, 'org-1', 't-1');

    expect(page.messages).toEqual([
      {
        id: 'm-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'm-2' }],
        sequence: 4,
        model: 'gpt-x',
        status: 'complete',
        createdAt: 4,
      },
    ]);
  });

  it('answers the cursor of its oldest row while older rows remain', async () => {
    const { sql } = fakeSql([
      { id: 'm-3', role: 'assistant', order: 9, stepOrder: 0 },
      { id: 'm-2', role: 'assistant', order: 8, stepOrder: 3 },
      { id: 'm-1', role: 'tool', order: 8, stepOrder: 2 },
    ]);

    const page = await listMessageViewsPage(sql, 'org-1', 't-1', { limit: 2 });

    expect(page.messages.map((row) => row.id)).toEqual(['m-2', 'm-3']);
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toEqual({ order: 8, stepOrder: 3 });
  });

  it('reads the page strictly before the cursor it is given', async () => {
    const { sql, calls } = fakeSql([]);

    await listMessageViewsPage(sql, 'org-1', 't-1', {
      before: { order: 8, stepOrder: 3 },
    });

    const [call] = calls;
    expect(call?.text).toContain('("order", step_order) < (?, ?)');
    expect(call?.values.slice(4, 7)).toEqual([false, 8, 3]);
  });
});
