/**
 * The bell's read state: a watermark per person and category that Read all
 * moves, plus the notifications above it read one by one. These tests pin
 * the statements each door sends (the real-Postgres proof is the bell probe
 * in `backend/integration-check.ts`): which categories a role reaches, where
 * the count's scan starts, and how far Read all moves the watermark.
 */

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emitHintInTx } = vi.hoisted(() => ({
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));

import {
  listNotifications,
  markAllRead,
  markRead,
  READ_ALL_SETTLE_MS,
  unreadCount,
  unreadScanFloor,
  type NotificationScope,
  type ReadWatermark,
} from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

interface Answer {
  rows?: unknown[];
  count?: number;
}

/**
 * A `sql` stand-in that records every statement, with `?` for each value,
 * and answers through `answer`: rows for a read, a count for a write.
 */
function recordingSql(answer: (statement: Statement) => Answer = () => ({})) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    const { rows = [], count = rows.length } = answer(statement);
    return Promise.resolve(Object.assign([...rows], { count }));
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
    sql: tag as unknown as Sql & TransactionSql,
    statements,
  };
}

const admin: NotificationScope = {
  orgId: 'org-1',
  userId: 'mia',
  role: 'admin',
};
const member: NotificationScope = {
  orgId: 'org-1',
  userId: 'noah',
  role: 'member',
};

const NOW = 1_800_000_000_000;

function find(statements: Statement[], start: string): Statement {
  const statement = statements.find((s) => s.text.startsWith(start));
  if (statement === undefined) {
    throw new Error(`no statement starts with ${start}`);
  }
  return statement;
}

/** The watermark rows of a scope, answered to the count's first read. */
function withWatermarks(watermarks: ReadWatermark[], count = '0') {
  return ({ text }: Statement): Answer => {
    if (text.includes('FROM app.notification_read_watermarks WHERE')) {
      return { rows: watermarks };
    }
    if (text.startsWith('SELECT count(*)')) return { rows: [{ count }] };
    return {};
  };
}

beforeEach(() => {
  emitHintInTx.mockClear();
});

describe('security notifications in the bell [NOTIF-R6]', () => {
  it('lists, counts and marks none for a member', async () => {
    const { sql, statements } = recordingSql(
      withWatermarks([{ category: 'system', ms: 100, id: 'n1' }]),
    );
    await listNotifications(sql, member);
    await unreadCount(sql, member);
    await markRead(sql, member, 'n9');

    const visibility = "(? OR n.category <> 'security')";
    const list = find(statements, 'SELECT n.id');
    const count = find(statements, 'SELECT count(*)');
    const read = find(statements, 'INSERT INTO app.notification_reads');
    for (const statement of [list, count, read]) {
      expect(statement.text).toContain(visibility);
      expect(statement.values).toContain(false);
      expect(statement.values).not.toContain(true);
    }
  });

  it('lists, counts and marks them for an admin', async () => {
    const { sql, statements } = recordingSql(withWatermarks([]));
    await listNotifications(sql, admin);
    await unreadCount(sql, admin);
    await markRead(sql, admin, 'n9');

    for (const start of [
      'SELECT n.id',
      'SELECT count(*)',
      'INSERT INTO app.notification_reads',
    ]) {
      expect(find(statements, start).values).toContain(true);
    }
  });

  it("moves only a member's system watermark when they mark all as read", async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.startsWith('SELECT n.created_at_ms')
        ? { rows: [{ ms: 100, id: 'n1' }] }
        : { count: 1 },
    );
    await markAllRead(sql, member, NOW);

    const settled = find(statements, 'SELECT n.created_at_ms');
    expect(settled.text).toContain("(? OR n.category <> 'security')");
    expect(settled.values).toContain(false);
    const moved = find(
      statements,
      'INSERT INTO app.notification_read_watermarks',
    );
    expect(moved.values).toContainEqual(['system']);
    const pruned = find(statements, 'DELETE FROM app.notification_reads');
    expect(pruned.values).toContainEqual(['system']);
    const window = find(statements, 'INSERT INTO app.notification_reads');
    expect(window.values).toContain(false);
  });

  it("moves both of an admin's watermarks when they mark all as read", async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.startsWith('SELECT n.created_at_ms')
        ? { rows: [{ ms: 100, id: 'n1' }] }
        : { count: 1 },
    );
    await markAllRead(sql, admin, NOW);

    const moved = find(
      statements,
      'INSERT INTO app.notification_read_watermarks',
    );
    expect(moved.values).toContainEqual(['security', 'system']);
  });

  it("starts a member's count at their system watermark alone", () => {
    expect(
      unreadScanFloor([{ category: 'system', ms: 100, id: 'n1' }], ['system']),
    ).toBe(100);
  });
});

describe('the unread count [NOTIF-R7]', () => {
  it('scans from the oldest watermark of the categories the person sees', () => {
    expect(
      unreadScanFloor(
        [
          { category: 'security', ms: 50, id: 'n1' },
          { category: 'system', ms: 80, id: 'n2' },
        ],
        ['security', 'system'],
      ),
    ).toBe(50);
  });

  it('scans everything while a category the person sees has no watermark', () => {
    expect(unreadScanFloor([], ['system'])).toBe(0);
    expect(
      unreadScanFloor(
        [{ category: 'system', ms: 80, id: 'n2' }],
        ['security', 'system'],
      ),
    ).toBe(0);
  });

  it('counts what came after the watermark, less what was read one by one', async () => {
    const { sql, statements } = recordingSql(
      withWatermarks(
        [
          { category: 'security', ms: 50, id: 'n1' },
          { category: 'system', ms: 80, id: 'n2' },
        ],
        '2',
      ),
    );
    await expect(unreadCount(sql, admin)).resolves.toBe(2);

    const count = find(statements, 'SELECT count(*)');
    expect(count.text).toContain('n.created_at_ms >= ?');
    expect(count.values).toContain(50);
    expect(count.text).toContain('AND m.category = n.category');
    expect(count.text).toContain(
      '(m.read_up_to_ms IS NULL OR (n.created_at_ms, n.id) > (m.read_up_to_ms, m.read_up_to_id))',
    );
    expect(count.text).toContain(
      'NOT EXISTS ( SELECT 1 FROM app.notification_reads r WHERE r.notification_id = n.id AND r.user_id = ? )',
    );
  });

  it('lists a notification under the watermark as read', async () => {
    const { sql, statements } = recordingSql(() => ({
      rows: [{ id: 'n1', createdAt: 10, read: true }],
    }));
    const page = await listNotifications(sql, admin);

    expect(page.items[0]?.read).toBe(true);
    expect(find(statements, 'SELECT n.id').text).toContain(
      '(r.notification_id IS NOT NULL OR (m.read_up_to_ms IS NOT NULL AND (n.created_at_ms, n.id) <= (m.read_up_to_ms, m.read_up_to_id))) AS "read"',
    );
  });

  it('reads one only when the watermark does not cover it yet', async () => {
    const { sql, statements } = recordingSql(() => ({ count: 0 }));
    await markRead(sql, admin, 'n1');

    expect(
      find(statements, 'INSERT INTO app.notification_reads').text,
    ).toContain(
      'AND NOT EXISTS ( SELECT 1 FROM app.notification_read_watermarks m WHERE m.org_id = n.org_id AND m.user_id = ? AND m.category = n.category AND (n.created_at_ms, n.id) <= (m.read_up_to_ms, m.read_up_to_id) )',
    );
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it("tells the person's other tabs when one is read", async () => {
    const { sql } = recordingSql(() => ({ count: 1 }));
    await markRead(sql, admin, 'n1');

    expect(emitHintInTx).toHaveBeenCalledWith(sql, {
      orgId: 'org-1',
      userId: 'mia',
      entity: 'notification',
      entityId: 'n1',
    });
  });
});

describe('mark all as read [NOTIF-R8]', () => {
  it('moves the watermark only to a notification older than the settle window', async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.startsWith('SELECT n.created_at_ms')
        ? { rows: [{ ms: 100, id: 'n1' }] }
        : { count: 1 },
    );
    await markAllRead(sql, admin, NOW);

    const settled = find(statements, 'SELECT n.created_at_ms');
    expect(settled.text).toContain('AND n.created_at_ms < ?');
    expect(settled.text).toContain(
      'ORDER BY n.created_at_ms DESC, n.id DESC LIMIT 1',
    );
    expect(settled.values).toContain(NOW - READ_ALL_SETTLE_MS);

    const moved = find(
      statements,
      'INSERT INTO app.notification_read_watermarks',
    );
    expect(moved.values).toEqual(
      expect.arrayContaining(['org-1', 'mia', 100, 'n1', NOW]),
    );
    // Forward only.
    expect(moved.text).toContain(
      'WHERE (excluded.read_up_to_ms, excluded.read_up_to_id) > (m.read_up_to_ms, m.read_up_to_id)',
    );
  });

  it('marks the notifications of the window one by one', async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.startsWith('SELECT n.created_at_ms')
        ? { rows: [{ ms: 100, id: 'n1' }] }
        : { count: 1 },
    );
    await markAllRead(sql, admin, NOW);

    const window = find(statements, 'INSERT INTO app.notification_reads');
    expect(window.text).toContain('AND n.created_at_ms >= ?');
    expect(window.values).toContain(NOW - READ_ALL_SETTLE_MS);
    expect(window.text).toContain(
      'ON CONFLICT (notification_id, user_id) DO NOTHING',
    );
  });

  it('drops the read rows the watermark now covers', async () => {
    const { sql, statements } = recordingSql(({ text }) =>
      text.startsWith('SELECT n.created_at_ms')
        ? { rows: [{ ms: 100, id: 'n1' }] }
        : { count: 1 },
    );
    await markAllRead(sql, admin, NOW);

    const pruned = find(statements, 'DELETE FROM app.notification_reads');
    expect(pruned.text).toContain('WHERE r.user_id = ?');
    expect(pruned.text).toContain('(n.created_at_ms, n.id) <= (?::bigint, ?)');
    expect(pruned.values).toEqual(
      expect.arrayContaining(['mia', 'org-1', 100, 'n1']),
    );
  });

  it('moves no watermark when every notification is inside the window', async () => {
    const { sql, statements } = recordingSql(() => ({ count: 2 }));
    await markAllRead(sql, admin, NOW);

    expect(
      statements.some((s) =>
        s.text.startsWith('INSERT INTO app.notification_read_watermarks'),
      ),
    ).toBe(false);
    expect(statements.some((s) => s.text.startsWith('DELETE FROM'))).toBe(
      false,
    );
    expect(
      find(statements, 'INSERT INTO app.notification_reads').values,
    ).toContain(NOW - READ_ALL_SETTLE_MS);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  it('sends no hint when nothing was left to mark', async () => {
    const { sql } = recordingSql(({ text }) =>
      text.startsWith('SELECT n.created_at_ms')
        ? { rows: [{ ms: 100, id: 'n1' }] }
        : { count: 0 },
    );
    await markAllRead(sql, admin, NOW);

    expect(emitHintInTx).not.toHaveBeenCalled();
  });
});
