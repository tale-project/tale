/**
 * The bell's page (#5158): one person's rows in one organization, newest
 * first, behind a `seq` cursor. Its unread filter and its cursor used to be
 * written as `(${unreadOnly} = false OR read = false)` and
 * `(${cursor}::bigint IS NULL OR seq < ${cursor})`, one statement for every
 * page, whose generic plan, which a prepared statement may settle on, cannot
 * bound a scan by a cursor it does not see: each later page would walk every
 * entry above its cursor. Each filter is now in the statement only when it
 * is set.
 *
 * Postgres proves the plans (`notification-paging.integration.ts`); these
 * tests pin the statement each page sends and how a page is cut.
 */

import { describe, expect, it } from 'vitest';

import { recordingSql } from '../agent_connections/test-helpers.ts';
import { listMyNotifications } from './service.ts';

const WHO = { organizationId: 'org-1', userId: 'u-reader' };

describe('listMyNotifications', () => {
  it.each([
    ['the first page', {}, '', []],
    ['a later page', { cursor: 40 }, ' AND seq < ?', [40]],
    ['the first unread page', { unreadOnly: true }, ' AND read = false', []],
    [
      'a later unread page',
      { unreadOnly: true, cursor: 40 },
      ' AND read = false AND seq < ?',
      [40],
    ],
  ])(
    'sends %s with only the filters it has',
    async (_page, filters, predicates, bound) => {
      const { sql, statements } = recordingSql();
      await listMyNotifications(sql, { ...WHO, ...filters, limit: 25 });
      expect(statements).toHaveLength(1);
      const [statement] = statements;
      expect(statement?.text).toContain(
        `FROM app.user_notifications WHERE user_id = ? AND org_id = ?${predicates} ORDER BY seq DESC LIMIT ?`,
      );
      expect(statement?.text).not.toMatch(/IS NULL|\bOR\b/);
      expect(statement?.values).toEqual([
        WHO.userId,
        WHO.organizationId,
        ...bound,
        26,
      ]);
    },
  );

  it('reads one row past the page and hands back the last row as the cursor', async () => {
    const row = (seq: number) => ({ id: `n-${seq}`, seq });
    const { sql } = recordingSql(() => [row(50), row(45), row(40)]);
    const page = await listMyNotifications(sql, { ...WHO, limit: 2 });
    expect(page).toEqual({
      rows: [{ id: 'n-50' }, { id: 'n-45' }],
      nextCursor: 45,
    });
  });

  it('hands back no cursor on the last page', async () => {
    const { sql } = recordingSql(() => [{ id: 'n-50', seq: 50 }]);
    const page = await listMyNotifications(sql, { ...WHO, limit: 2 });
    expect(page).toEqual({ rows: [{ id: 'n-50' }], nextCursor: null });
  });
});
