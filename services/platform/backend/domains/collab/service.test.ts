import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NOTIFICATION_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { coalesceKeyFor } from '../../core/collab/coalesce.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import {
  dismissReviewRequestNotifications,
  markAllNotificationsRead,
  writeCoalescedNotification,
} from './service.ts';

vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

type Row = Record<string, unknown>;

/**
 * A postgres.js tagged-template stand-in: the test answers each statement
 * from its (whitespace-collapsed) text. Only the shapes the collab writer
 * touches are modelled — the hint side effect is what these tests pin.
 */
function fakeDb(answer: (text: string) => Row[]): {
  db: Sql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    return Promise.resolve(answer(text));
  };
  const db = Object.assign(tag, { json: (value: unknown) => value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js template function
  return { db: db as unknown as Sql, statements };
}

const RECIPIENT = { userId: 'u-recipient', organizationId: 'org-1' };

/** A status bell for a task (a coalescing, non-emailing type). */
const statusBell = {
  ...RECIPIENT,
  type: 'task_status_changed',
  titleKey: 'taskStatusChanged',
  bodyKey: 'taskStatusChangedBody',
  params: { to: 'in_progress' },
  resourceType: 'task',
  resourceId: 'task-1',
  taskId: 'task-1',
  actorType: 'agent' as const,
  actorId: 'agent-1',
};

const twinKey = coalesceKeyFor(
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pure fn narrows internally; the test only needs the key string
  statusBell as unknown as Parameters<typeof coalesceKeyFor>[0],
);

beforeEach(() => {
  vi.mocked(emitHintInTx).mockReset();
});

describe('the personal bell hint (wire contract with the web app)', () => {
  it('names the entity the app keys the bell on', () => {
    // The app's `engagement.ts` keys every bell read under this constant;
    // `use-backend-hints.ts` invalidates by `['backend', orgId, entity]`.
    // The literal is the wire — pin it, so a rename shows up here first.
    expect(NOTIFICATION_HINT_ENTITY).toBe('notification');
  });

  it('a fresh bell row emits one hint, to the recipient only', async () => {
    const { db } = fakeDb((text) => {
      if (text.startsWith('SELECT id, coalesce_key')) return [];
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return [{ id: 'n-new' }];
      }
      return [];
    });
    await expect(writeCoalescedNotification(db, statusBell)).resolves.toBe(
      'inserted',
    );
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledWith(db, {
      orgId: 'org-1',
      userId: 'u-recipient',
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: null,
    });
  });

  it('a rewrite of the unread twin emits the same recipient-scoped hint', async () => {
    const { db, statements } = fakeDb((text) => {
      if (text.startsWith('SELECT id, coalesce_key')) {
        return [{ id: 'n-twin', coalesceKey: twinKey }];
      }
      return [];
    });
    await expect(writeCoalescedNotification(db, statusBell)).resolves.toBe(
      'rewritten',
    );
    expect(
      statements.some((s) =>
        s.startsWith('UPDATE app.user_notifications SET type'),
      ),
    ).toBe(true);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledWith(db, {
      orgId: 'org-1',
      userId: 'u-recipient',
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: null,
    });
  });

  it('an undo that drops the unread twin still tells the recipient', async () => {
    const { db, statements } = fakeDb((text) => {
      if (text.startsWith('SELECT id, coalesce_key')) {
        return [{ id: 'n-twin', coalesceKey: twinKey }];
      }
      return [];
    });
    await expect(
      writeCoalescedNotification(db, { ...statusBell, undoes: true }),
    ).resolves.toBe('cancelled');
    expect(
      statements.some((s) =>
        s.startsWith('DELETE FROM app.user_notifications'),
      ),
    ).toBe(true);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledWith(db, {
      orgId: 'org-1',
      userId: 'u-recipient',
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: null,
    });
  });

  it('mark-all-read hints the reader (other tabs drop the badge), never on a no-op', async () => {
    const marked = fakeDb(() => [{ id: 'n1' }, { id: 'n2' }]);
    await expect(
      markAllNotificationsRead(marked.db, 'org-1', 'u-recipient'),
    ).resolves.toBe(2);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledWith(marked.db, {
      orgId: 'org-1',
      userId: 'u-recipient',
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: null,
    });

    vi.mocked(emitHintInTx).mockReset();
    const nothing = fakeDb(() => []);
    await expect(
      markAllNotificationsRead(nothing.db, 'org-1', 'u-recipient'),
    ).resolves.toBe(0);
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('a server-side dismissal hints each affected recipient once', async () => {
    const { db } = fakeDb(() => [
      { id: 'n1', userId: 'u-a' },
      { id: 'n2', userId: 'u-a' },
      { id: 'n3', userId: 'u-b' },
    ]);
    await expect(
      dismissReviewRequestNotifications(db, {
        organizationId: 'org-1',
        approvalId: 'approval-1',
      }),
    ).resolves.toBe(3);
    const recipients = vi
      .mocked(emitHintInTx)
      .mock.calls.map(([, hint]) => hint.userId ?? '')
      .sort((a, b) => a.localeCompare(b));
    expect(recipients).toEqual(['u-a', 'u-b']);
    for (const [, hint] of vi.mocked(emitHintInTx).mock.calls) {
      expect(hint.entity).toBe(NOTIFICATION_HINT_ENTITY);
      expect(hint.orgId).toBe('org-1');
    }
  });
});
