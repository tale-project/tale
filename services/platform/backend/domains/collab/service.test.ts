import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NOTIFICATION_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { coalesceKeyFor } from '../../core/collab/coalesce.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import type { CollabNotificationInput } from './service.ts';
import {
  dismissReviewerAssignedNotifications,
  dismissReviewRequestNotifications,
  dismissTriggerPausedNotifications,
  markAllNotificationsRead,
  notifyTaskComment,
  notifyTaskMentions,
  notifyTaskReviewerAssigned,
  notifyTriggerPaused,
  notifyTaskReviewRequested,
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
  calls: { text: string; values: unknown[] }[];
} {
  const statements: string[] = [];
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    calls.push({ text, values });
    return Promise.resolve(answer(text));
  };
  const db = Object.assign(tag, { json: (value: unknown) => value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js template function
  return { db: db as unknown as Sql, statements, calls };
}

/** The `params` bag an INSERT carried, read back off the captured values. */
function insertedParams(
  calls: { text: string; values: unknown[] }[],
): Record<string, unknown> | undefined {
  const insert = calls.find((c) =>
    c.text.startsWith('INSERT INTO app.user_notifications'),
  );
  return insert?.values.find(
    (v): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && 'to' in v,
  );
}

const RECIPIENT = { userId: 'u-recipient', organizationId: 'org-1' };

/** A status bell for a task (a coalescing, non-emailing type). */
const statusBell = {
  ...RECIPIENT,
  type: 'task_status_changed',
  titleKey: 'taskStatusChanged',
  bodyKey: 'taskStatusChangedBody',
  params: { to: 'in_progress', projectId: 'proj-1' },
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

/**
 * A task row that arrived WITHOUT its project — the shape
 * `CollabNotificationInput` now refuses from a typed caller, and so
 * reachable only from dynamically built args or from behind a cast. The cast
 * IS the test: it reproduces what the writer must still repair at runtime.
 */
const projectlessBell = {
  ...statusBell,
  params: { to: 'in_progress' },
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately the shape the union forbids
} as unknown as CollabNotificationInput;

describe('a task-bound row always carries its project', () => {
  it('resolves the project from the task when the caller left it out', async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.startsWith('SELECT project_id')) {
        return [{ projectId: 'proj-resolved' }];
      }
      if (text.startsWith('SELECT id, coalesce_key')) return [];
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return [{ id: 'n-new' }];
      }
      return [];
    });

    await expect(writeCoalescedNotification(db, projectlessBell)).resolves.toBe(
      'inserted',
    );
    expect(insertedParams(calls)).toEqual({
      to: 'in_progress',
      projectId: 'proj-resolved',
    });
  });

  it('does not look the project up when the caller supplied one', async () => {
    const { db, statements } = fakeDb((text) => {
      if (text.startsWith('SELECT id, coalesce_key')) return [];
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return [{ id: 'n-new' }];
      }
      return [];
    });

    await writeCoalescedNotification(db, statusBell);
    expect(statements.some((s) => s.startsWith('SELECT project_id'))).toBe(
      false,
    );
  });

  it("invents nothing when the task is not in the row's organization", async () => {
    // The lookup is org-scoped, so a task id belonging to another tenant
    // answers no row. Leave the bag as it came rather than linking to
    // something the recipient cannot see.
    const { db, calls, statements } = fakeDb((text) => {
      if (text.startsWith('SELECT id, coalesce_key')) return [];
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return [{ id: 'n-new' }];
      }
      return [];
    });

    await writeCoalescedNotification(db, projectlessBell);
    const lookup = statements.find((s) => s.startsWith('SELECT project_id'));
    // Tenant isolation is the point: the lookup is keyed by BOTH the task
    // and the row's organization, so another tenant's task answers no row.
    expect(lookup).toContain('org_id = ?');
    expect(insertedParams(calls)).toEqual({ to: 'in_progress' });
  });
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

describe('the reviewer-designation heads-up (task_reviewer_assigned)', () => {
  /** Like `fakeDb`, but keeps each statement's VALUES so the row written can
   * be pinned (type, keys, params), not only the statement shape. */
  function recordingDb(answer: (text: string) => Row[]): {
    db: Sql;
    calls: { text: string; values: unknown[] }[];
  } {
    const calls: { text: string; values: unknown[] }[] = [];
    const tag = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<Row[]> => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      calls.push({ text, values });
      return Promise.resolve(answer(text));
    };
    const db = Object.assign(tag, { json: (value: unknown) => value });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js template function
    return { db: db as unknown as Sql, calls };
  }

  const designation = {
    organizationId: 'org-1',
    task: { id: 'task-1', projectId: 'proj-1', title: 'Ship the brief' },
    reviewerUserId: 'u-recipient',
    actorUserId: 'u-actor',
  };

  it('bells the designee on the task and hints their bell — no pref gate', async () => {
    // The 0.4 bell that never fired in 0.5: the live reviewer write only
    // stored the column. The heads-up is bell-only (not actionable, no
    // email) and skips the preference gate like the request — the review
    // group is locked on.
    const { db, calls } = recordingDb((text) => {
      if (text.startsWith('SELECT "name", "email" FROM "user"')) {
        return [{ name: 'Ada', email: 'ada@example.com' }];
      }
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return [{ id: 'n-reviewer' }];
      }
      return [];
    });
    await notifyTaskReviewerAssigned(db, designation);
    const insert = calls.find((call) =>
      call.text.startsWith('INSERT INTO app.user_notifications'),
    );
    expect(insert).toBeDefined();
    expect(insert?.values).toEqual(
      expect.arrayContaining([
        'u-recipient',
        'org-1',
        'task_reviewer_assigned',
        'taskReviewerAssigned',
        'taskReviewerAssignedByBody',
        'task',
        'task-1',
        'user',
        'u-actor',
      ]),
    );
    expect(insert?.values).toContainEqual({
      taskId: 'task-1',
      projectId: 'proj-1',
      taskTitle: 'Ship the brief',
      actor: 'Ada',
    });
    expect(calls.some((call) => call.text.includes('preferences'))).toBe(false);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledWith(db, {
      orgId: 'org-1',
      userId: 'u-recipient',
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: null,
    });
  });

  it('designating yourself rings nothing', async () => {
    const { db, calls } = recordingDb(() => []);
    await notifyTaskReviewerAssigned(db, {
      ...designation,
      reviewerUserId: 'u-actor',
    });
    expect(calls).toEqual([]);
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('a moved designation marks only the former designee’s unread heads-up on this task read, and hints them', async () => {
    // Before the fix a change of reviewer ahead of In review left "You're
    // the reviewer" ringing for the person it was taken from.
    const { db, calls } = recordingDb((text) =>
      text.startsWith('UPDATE app.user_notifications') ? [{ id: 'n-1' }] : [],
    );
    await expect(
      dismissReviewerAssignedNotifications(db, {
        organizationId: 'org-1',
        taskId: 'task-1',
        userId: 'u-recipient',
      }),
    ).resolves.toBe(1);
    const update = calls.find((call) =>
      call.text.startsWith('UPDATE app.user_notifications'),
    );
    expect(update?.text).toContain('read = true');
    expect(update?.text).toContain("type = 'task_reviewer_assigned'");
    expect(update?.text).toContain('read = false');
    expect(update?.values).toEqual(
      expect.arrayContaining(['org-1', 'u-recipient', 'task-1']),
    );
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledWith(db, {
      orgId: 'org-1',
      userId: 'u-recipient',
      entity: NOTIFICATION_HINT_ENTITY,
      entityId: null,
    });
  });

  it('a moved designation with no unread heads-up hints nobody', async () => {
    const { db } = recordingDb(() => []);
    await expect(
      dismissReviewerAssignedNotifications(db, {
        organizationId: 'org-1',
        taskId: 'task-1',
        userId: 'u-recipient',
      }),
    ).resolves.toBe(0);
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('a review handed over by no person (an erasure) asks impersonally, as the system', async () => {
    const { db, calls } = recordingDb((text) =>
      text.startsWith('INSERT INTO app.user_notifications')
        ? [{ id: 'n-request' }]
        : [],
    );
    await notifyTaskReviewRequested(db, {
      organizationId: 'org-1',
      task: designation.task,
      reviewerUserId: 'u-recipient',
      approvalId: 'approval-1',
      submitter: { kind: 'system' },
    });
    // No actor to name: nobody's display name is read.
    expect(calls.some((call) => call.text.includes('FROM "user"'))).toBe(false);
    const insert = calls.find((call) =>
      call.text.startsWith('INSERT INTO app.user_notifications'),
    );
    expect(insert?.values).toEqual(
      expect.arrayContaining([
        'u-recipient',
        'task_review_requested',
        'taskReviewRequested',
        'taskReviewRequestedBodyHuman',
        'task_review',
        'approval-1',
        'system',
        null,
      ]),
    );
    expect(insert?.values).toContainEqual({
      taskId: 'task-1',
      projectId: 'proj-1',
      taskTitle: 'Ship the brief',
      approvalId: 'approval-1',
    });
  });
});

describe('the mention bell, per surface', () => {
  const task = {
    id: 'task-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    title: 'Ship the brief',
  };
  const answer = (text: string): Row[] => {
    if (text.startsWith('SELECT "name", "email" FROM "user"')) {
      return [{ name: 'Ada', email: 'ada@example.com' }];
    }
    if (text.startsWith('INSERT INTO app.user_notifications')) {
      return [{ id: 'n-mention' }];
    }
    return [];
  };
  const inserts = (
    calls: { text: string; values: unknown[] }[],
    table: string,
  ) => calls.filter((call) => call.text.startsWith(`INSERT INTO ${table}`));

  it('a description names the humans on the task itself — never the actor, never an agent', async () => {
    const { db, calls } = fakeDb(answer);
    await notifyTaskMentions(db, {
      task,
      mentions: [
        { type: 'user', id: 'u-recipient' },
        { type: 'agent', id: 'agent-1' },
        { type: 'user', id: 'u-actor' },
        { type: 'automation', id: 'triage' },
      ],
      actorType: 'user',
      actorId: 'u-actor',
    });

    // The named teammate starts following the task, as a comment mention
    // would make them.
    expect(
      inserts(calls, 'app.task_subscriptions').map((call) =>
        call.values.slice(0, 5),
      ),
    ).toEqual([['org-1', 'task-1', 'user', 'u-recipient', 'mention']]);
    const bells = inserts(calls, 'app.user_notifications');
    expect(bells).toHaveLength(1);
    // No comment carries the mention, so the row points at the task.
    expect(bells[0]?.values).toEqual(
      expect.arrayContaining([
        'u-recipient',
        'mention',
        'mentionByBody',
        'task',
        'task-1',
        'u-actor',
      ]),
    );
    expect(bells[0]?.values).toContainEqual({
      title: 'Ship the brief',
      projectId: 'proj-1',
      actor: 'Ada',
    });
    // A description edit is not a new comment: the watchers are not told.
    expect(
      calls.some((call) => call.text.startsWith('SELECT subscriber_id')),
    ).toBe(false);
  });

  it('a description naming no human writes nothing', async () => {
    const { db, calls } = fakeDb(answer);
    await notifyTaskMentions(db, {
      task,
      mentions: [{ type: 'agent', id: 'agent-1' }],
      actorType: 'user',
      actorId: 'u-actor',
    });
    expect(calls).toEqual([]);
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('a comment still points its mention row at the comment', async () => {
    const { db, calls } = fakeDb(answer);
    await notifyTaskComment(db, {
      task,
      commentId: 'msg-1',
      mentions: [{ type: 'user', id: 'u-recipient' }],
      actorType: 'user',
      actorId: 'u-actor',
      notifySubscribers: false,
    });
    const bells = inserts(calls, 'app.user_notifications');
    expect(bells).toHaveLength(1);
    expect(bells[0]?.values).toEqual(
      expect.arrayContaining(['u-recipient', 'mention', 'comment', 'msg-1']),
    );
  });
});

describe('the paused-schedule notice (automation_failed)', () => {
  /** Like `fakeDb`, but the answer also sees the statement's values — the
   * preference read answers per recipient. */
  function fakeDbWithValues(
    answer: (text: string, values: unknown[]) => Row[],
  ): { db: Sql; calls: { text: string; values: unknown[] }[] } {
    const calls: { text: string; values: unknown[] }[] = [];
    const tag = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<Row[]> => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      calls.push({ text, values });
      return Promise.resolve(answer(text, values));
    };
    const db = Object.assign(tag, { json: (value: unknown) => value });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js template function
    return { db: db as unknown as Sql, calls };
  }

  const PAUSE = {
    organizationId: 'org-1',
    triggerId: 'trg-1',
    name: 'ops/nightly',
    failures: 5,
    code: 'connector_error',
  };

  beforeEach(() => {
    vi.mocked(addJobInTx).mockReset();
  });

  it('writes one actionable row per owner and admin who has not muted automation alerts', async () => {
    const fake = fakeDbWithValues((text, values) => {
      if (text.startsWith('SELECT "userId" FROM "member"')) {
        return [{ userId: 'owner-1' }, { userId: 'admin-muted' }];
      }
      if (text.includes('FROM app.notification_preferences')) {
        return values[0] === 'admin-muted'
          ? [{ automation_alerts: false }]
          : [];
      }
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return [{ id: 'n-1' }];
      }
      if (text.startsWith('UPDATE app.user_notifications SET email_epoch')) {
        return [{ emailEpoch: 1 }];
      }
      return [];
    });

    await expect(notifyTriggerPaused(fake.db, PAUSE)).resolves.toBe(2);

    const members = fake.calls.find((c) =>
      c.text.startsWith('SELECT "userId" FROM "member"'),
    );
    expect(members?.text).toContain(`lower("role") IN ('owner', 'admin')`);
    expect(members?.values).toEqual(['org-1']);
    // The preference read names the column the toggle writes.
    expect(
      fake.calls.find((c) =>
        c.text.includes('FROM app.notification_preferences'),
      )?.text,
    ).toContain('automation_alerts');

    const inserts = fake.calls.filter((c) =>
      c.text.startsWith('INSERT INTO app.user_notifications'),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toEqual(
      expect.arrayContaining([
        'owner-1',
        'org-1',
        'automation_failed',
        'automationTriggerPaused',
        'automationTriggerPausedBody',
        {
          name: 'ops/nightly',
          failures: 5,
          code: 'connector_error',
          trigger: true,
        },
        'automation_trigger',
        'trg-1',
        'system',
        // A second pause while the row is unread rewrites it in place.
        'automation_trigger:trg-1:paused',
      ]),
    );
    // Actionable: it leaves the app by email too.
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.db,
      'notification.email',
      { notificationId: 'n-1', epoch: 1 },
      expect.anything(),
    );
  });

  it('marks every unread notice of the trigger read and hints each recipient', async () => {
    const fake = fakeDbWithValues((text) =>
      text.startsWith('UPDATE app.user_notifications SET read = true')
        ? [{ userId: 'owner-1' }, { userId: 'admin-1' }]
        : [],
    );

    await expect(
      dismissTriggerPausedNotifications(fake.db, {
        organizationId: 'org-1',
        triggerId: 'trg-1',
      }),
    ).resolves.toBe(2);

    const dismissal = fake.calls[0];
    expect(dismissal?.text).toContain(
      "type = 'automation_failed' AND read = false",
    );
    expect(dismissal?.values).toEqual([expect.any(Number), 'org-1', 'trg-1']);
    expect(vi.mocked(emitHintInTx).mock.calls.map((call) => call[1])).toEqual([
      {
        orgId: 'org-1',
        userId: 'owner-1',
        entity: NOTIFICATION_HINT_ENTITY,
        entityId: null,
      },
      {
        orgId: 'org-1',
        userId: 'admin-1',
        entity: NOTIFICATION_HINT_ENTITY,
        entityId: null,
      },
    ]);
  });
});
