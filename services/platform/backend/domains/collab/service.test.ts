import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NOTIFICATION_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import {
  notificationTargetPath,
  personalNotificationTarget,
} from '../../../lib/shared/notifications/target.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { coalesceKeyFor } from '../../core/collab/coalesce.ts';
import { buildPersonalNotificationUrl } from '../../core/notifications/personal_notification_url.ts';
import { addJobInTx, addJobsInTx } from '../../jobs/enqueue.ts';
import {
  emitHintInTx,
  emitHintsInTx,
  type Hint,
} from '../../realtime/outbox.ts';
import type { CollabNotificationInput } from './service.ts';
import {
  dismissAgentRunFailedNotifications,
  dismissReviewerAssignedNotifications,
  dismissReviewRequestNotifications,
  dismissTriggerPausedNotifications,
  markAllNotificationsRead,
  notifyAgentQuestionAsked,
  notifyAgentRunFailed,
  notifyAutomationMessage,
  notifyConversationAssignedTeam,
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskMentions,
  notifyTaskReviewerAssigned,
  notifyTaskReviewRequested,
  notifyTaskStatusChanged,
  notifyTriggerPaused,
  writeCoalescedNotification,
  writeCoalescedNotifications,
} from './service.ts';

vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(),
  emitHintsInTx: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(),
  addJobsInTx: vi.fn(),
}));

type Row = Record<string, unknown>;

/** The writer's "who can open this task now" read (`taskReadersAmong`). */
const isReaderCheck = (text: string): boolean =>
  text.startsWith('WITH audience AS');

/** The writer's one look for its recipients' unread twins. */
const isTwinScan = (text: string): boolean =>
  text.startsWith('SELECT DISTINCT ON (recipient.user_id)');

/** The list a batched statement works through, its last value: the people
 * an insert writes for, the rows a rewrite or a delete names. */
function batchOf(call: { values: unknown[] } | undefined): unknown[] {
  const list = call?.values.at(-1);
  return Array.isArray(list) ? list : [];
}

/** Every hint the code under test emitted, alone or in a batch. */
function hintsEmitted(): Hint[] {
  return [
    ...vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint),
    ...vi.mocked(emitHintsInTx).mock.calls.flatMap(([, hints]) => hints),
  ];
}

/** The payload of every email the code under test queued. */
function emailsQueued(): unknown[] {
  return [
    ...vi
      .mocked(addJobInTx)
      .mock.calls.filter(
        ([, identifier]) => identifier === 'notification.email',
      )
      .map(([, , payload]) => payload),
    ...vi
      .mocked(addJobsInTx)
      .mock.calls.filter(
        ([, identifier]) => identifier === 'notification.email',
      )
      .flatMap(([, , jobs]) => jobs.map((job) => job.payload)),
  ];
}

/** The preference read's answer: of the people it asks about (the list its
 * `= ANY` names), those in `off`, with `column` switched off. */
function preferencesOff(
  values: unknown[],
  off: readonly string[] | undefined,
  column: string,
): Row[] {
  const asked = values.find((value) => Array.isArray(value));
  return (Array.isArray(asked) ? asked : [])
    .filter((userId) => off?.includes(String(userId)) === true)
    .map((userId) => ({ userId, [column]: false }));
}

/** The bell hint for one person (`NOTIFICATION_HINT_ENTITY`, to them only). */
const bellHintFor = (userId: string): Hint => ({
  orgId: 'org-1',
  userId,
  entity: NOTIFICATION_HINT_ENTITY,
  entityId: null,
});

/** The reader check's answer: of the ids it was asked about (the `db(list)`
 * value), those in `readers` — everyone asked when the test names nobody. */
function readersAsked(values: unknown[], readers?: readonly string[]): Row[] {
  const asked = values.find((v): v is string[] => Array.isArray(v)) ?? [];
  return asked
    .filter((id) => readers === undefined || readers.includes(id))
    .map((userId) => ({ userId }));
}

/**
 * A postgres.js tagged-template stand-in: the test answers each statement
 * from its (whitespace-collapsed) text. Only the shapes the collab writer
 * touches are modelled — the hint side effect is what these tests pin.
 */
function fakeDb(
  answer: (text: string) => Row[],
  /** Who can open the task now; everyone asked when left out. */
  readers?: readonly string[],
): {
  db: Sql;
  statements: string[];
  calls: { text: string; values: unknown[] }[];
} {
  const statements: string[] = [];
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray | readonly string[],
    ...values: unknown[]
  ): unknown => {
    // `db(list)` — an IN list — hands the list back as the value.
    if (!('raw' in strings)) return strings;
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    calls.push({ text, values });
    if (isReaderCheck(text)) {
      return Promise.resolve(readersAsked(values, readers));
    }
    return Promise.resolve(answer(text));
  };
  const db = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (value: string) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js template function
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
  vi.mocked(emitHintsInTx).mockReset();
  vi.mocked(addJobInTx).mockReset();
  vi.mocked(addJobsInTx).mockReset();
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

  it("writes nothing when the task is not in the row's organization", async () => {
    // The reader check finds the task's project by BOTH the task and the
    // row's organization, so another tenant's task has no project here and
    // nobody here can open it: no row, and no link invented from its data.
    const { db, calls, statements } = fakeDb(() => [], []);

    await expect(writeCoalescedNotification(db, projectlessBell)).resolves.toBe(
      'withheld',
    );
    const check = calls.find((call) => isReaderCheck(call.text));
    expect(check?.text).toContain(
      'SELECT project_id FROM app.tasks WHERE id = ?::text AND org_id = ?',
    );
    expect(check?.values).toEqual(
      expect.arrayContaining(['org-1', 'task-1', ['u-recipient']]),
    );
    expect(statements).toHaveLength(1);
    expect(insertedParams(calls)).toBeUndefined();
  });
});

describe('a task-bound row is written only for someone who can open the task now (#3631) [COLLAB-R1]', () => {
  it('withholds the row from a recipient outside the task’s project: no row, no email, no hint', async () => {
    const { db, statements } = fakeDb(() => [], ['someone-else']);

    await expect(
      writeCoalescedNotification(db, {
        ...statusBell,
        type: 'task_assigned',
        titleKey: 'taskAssigned',
        bodyKey: 'taskAssignedBody',
      }),
    ).resolves.toBe('withheld');
    expect(statements).toHaveLength(1);
    expect(isReaderCheck(statements[0] ?? '')).toBe(true);
    expect(emailsQueued()).toEqual([]);
    expect(hintsEmitted()).toEqual([]);
  });

  it('withholds an undo too: a former reader’s history is left as it was', async () => {
    const { db, statements } = fakeDb(
      (text) =>
        isTwinScan(text) ? [{ userId: 'u-recipient', id: 'n-twin' }] : [],
      [],
    );

    await expect(
      writeCoalescedNotification(db, { ...statusBell, undoes: true }),
    ).resolves.toBe('withheld');
    expect(
      statements.some((s) =>
        s.startsWith('DELETE FROM app.user_notifications'),
      ),
    ).toBe(false);
  });

  it('judges the recipient by the task’s current project and this organization’s teams', async () => {
    const { db, calls } = fakeDb((text) =>
      text.startsWith('INSERT INTO app.user_notifications')
        ? [{ id: 'n-new' }]
        : [],
    );

    await expect(writeCoalescedNotification(db, statusBell)).resolves.toBe(
      'inserted',
    );
    const check = calls.find((call) => isReaderCheck(call.text));
    // The project is the task's own, looked up now — not the params' copy.
    expect(check?.text).toContain(
      'AND id = COALESCE(?::text, ( SELECT project_id FROM app.tasks',
    );
    // (After the audience column, which the stand-in passes as a value.)
    expect(check?.values.slice(1, 4)).toEqual(['org-1', null, 'task-1']);
    // A team counts only when it is this organization's.
    expect(check?.text).toContain(
      'JOIN "team" t ON t."id" = tm."teamId" WHERE tm."userId" = m."userId" AND t."organizationId" = ?',
    );
    expect(check?.text).toContain(`lower(m."role") <> 'disabled'`);
    expect(check?.text).toContain(`lower(m."role") IN ('owner', 'admin')`);
    expect(check?.text).toContain('cardinality(audience."teamIds") = 0');
  });

  it('a row about no task asks nobody about access', async () => {
    const { db, statements } = fakeDb(
      (text) =>
        text.startsWith('INSERT INTO app.user_notifications')
          ? [{ id: 'n-new' }]
          : [],
      [],
    );

    await expect(
      writeCoalescedNotification(db, {
        ...RECIPIENT,
        type: 'conversation_assigned',
        titleKey: 'conversationAssigned',
        bodyKey: 'conversationAssignedBody',
        params: { subject: 'Invoice', conversationId: 'conv-1' },
        resourceType: 'conversation',
        resourceId: 'conv-1',
        actorType: 'system',
      }),
    ).resolves.toBe('inserted');
    expect(statements.some(isReaderCheck)).toBe(false);
  });

  const TASK = {
    id: 'task-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    title: 'Acquisition of Contoso',
  };
  /** `[recipient, type]` of every row written (an insert's type is its
   * second value, after the organization). */
  const written = (calls: { text: string; values: unknown[] }[]) =>
    calls
      .filter((call) =>
        call.text.startsWith('INSERT INTO app.user_notifications'),
      )
      .flatMap((call) =>
        batchOf(call).map((userId) => [userId, call.values[1]]),
      );
  const answer = (text: string): Row[] => {
    if (text.includes('FROM app.task_subscriptions')) {
      return [{ subscriberId: 'u-watcher' }, { subscriberId: 'u-departed' }];
    }
    if (text.startsWith('INSERT INTO app.user_notifications')) {
      return [{ id: 'n-new' }];
    }
    return [];
  };

  it('tells the watchers who can open the task of a status change, not one taken off its team', async () => {
    const { db, calls } = fakeDb(answer, ['u-watcher', 'u-actor']);

    await notifyTaskStatusChanged(db, {
      task: TASK,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      actorType: 'user',
      actorId: 'u-actor',
    });
    expect(written(calls)).toEqual([['u-watcher', 'task_status_changed']]);
  });

  it('keeps the unread assignment unchanged after access loss and reassignment (#4077)', async () => {
    const readers = ['u-departed', 'u-watcher'];
    const rows: Row[] = [];
    const { db, calls } = fakeDb((text) => {
      const call = calls.at(-1);
      if (isTwinScan(text)) {
        // Asked about `values[0]`, for the key it names last.
        const asked = call?.values[0];
        return rows
          .filter(
            (row) =>
              Array.isArray(asked) &&
              asked.includes(row.userId) &&
              row.coalesceKey === call?.values.at(-1),
          )
          .map((row) => ({ userId: row.userId, id: row.id }));
      }
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return batchOf(call).map((userId) => {
          const id = `n-${rows.length}`;
          rows.push({
            id,
            userId,
            read: false,
            coalesceKey: call?.values[11],
            params: call?.values[4],
          });
          return { id, emailEpoch: 1 };
        });
      }
      return [];
    }, readers);

    await notifyTaskAssigned(db, {
      task: TASK,
      assigneeType: 'user',
      assigneeId: 'u-departed',
      actorType: 'agent',
      actorId: 'agent-1',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.coalesceKey).toBe('task:task-1:assignment');
    const original = structuredClone(rows);
    const before = calls.length;
    vi.mocked(addJobsInTx).mockClear();
    vi.mocked(emitHintsInTx).mockClear();
    readers.splice(readers.indexOf('u-departed'), 1);

    await notifyTaskAssigned(db, {
      task: { ...TASK, title: 'Confidential new title' },
      assigneeType: 'user',
      assigneeId: 'u-watcher',
      previousAssigneeType: 'user',
      previousAssigneeId: 'u-departed',
      actorType: 'agent',
      actorId: 'agent-1',
    });

    expect(rows[0]).toEqual(original[0]);
    const reassignment = calls.slice(before);
    expect(
      reassignment.some((call) =>
        call.text.startsWith('DELETE FROM app.user_notifications'),
      ),
    ).toBe(false);
    expect(written(reassignment)).toEqual([['u-watcher', 'task_assigned']]);
    expect(hintsEmitted()).toEqual([bellHintFor('u-watcher')]);
    expect(emailsQueued()).toHaveLength(1);
  });

  it('tells a former assignee who lost access nothing; the new assignee is told', async () => {
    const { db, calls } = fakeDb(answer, ['u-watcher', 'u-actor']);

    await notifyTaskAssigned(db, {
      task: TASK,
      assigneeType: 'user',
      assigneeId: 'u-watcher',
      previousAssigneeType: 'user',
      previousAssigneeId: 'u-departed',
      actorType: 'user',
      actorId: 'u-actor',
    });
    expect(written(calls)).toEqual([['u-watcher', 'task_assigned']]);
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
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return [{ id: 'n-new' }];
      }
      return [];
    });
    await expect(writeCoalescedNotification(db, statusBell)).resolves.toBe(
      'inserted',
    );
    expect(vi.mocked(emitHintsInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHintsInTx)).toHaveBeenCalledWith(db, [
      bellHintFor('u-recipient'),
    ]);
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('a rewrite of the unread twin emits the same recipient-scoped hint', async () => {
    const { db, calls, statements } = fakeDb((text) =>
      isTwinScan(text) ? [{ userId: 'u-recipient', id: 'n-twin' }] : [],
    );
    await expect(writeCoalescedNotification(db, statusBell)).resolves.toBe(
      'rewritten',
    );
    // The twin is looked for on the status dimension of this task.
    expect(calls.find((call) => isTwinScan(call.text))?.values.at(-1)).toBe(
      twinKey,
    );
    expect(
      statements.some((s) =>
        s.startsWith('UPDATE app.user_notifications SET type'),
      ),
    ).toBe(true);
    expect(hintsEmitted()).toEqual([bellHintFor('u-recipient')]);
  });

  it('an undo that drops the unread twin still tells the recipient', async () => {
    const { db, statements } = fakeDb((text) =>
      isTwinScan(text) ? [{ userId: 'u-recipient', id: 'n-twin' }] : [],
    );
    await expect(
      writeCoalescedNotification(db, { ...statusBell, undoes: true }),
    ).resolves.toBe('cancelled');
    expect(
      statements.some((s) =>
        s.startsWith('DELETE FROM app.user_notifications'),
      ),
    ).toBe(true);
    expect(hintsEmitted()).toEqual([bellHintFor('u-recipient')]);
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
    // All of them in one statement.
    expect(vi.mocked(emitHintsInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHintsInTx)).toHaveBeenCalledWith(db, [
      bellHintFor('u-a'),
      bellHintFor('u-b'),
    ]);
  });
});

describe('a rewritten row leads the first page of the bell (#3630)', () => {
  it('takes a fresh seq with its new createdAt, in place of the old row', async () => {
    const { db, calls, statements } = fakeDb((text) =>
      isTwinScan(text) ? [{ userId: 'u-recipient', id: 'n-twin' }] : [],
    );
    await expect(
      writeCoalescedNotification(db, {
        ...statusBell,
        params: { ...statusBell.params, to: 'done' },
      }),
    ).resolves.toBe('rewritten');
    const rewrite = calls.find((c) =>
      c.text.startsWith('UPDATE app.user_notifications SET type'),
    );
    // `listMyNotifications` orders and cursors by `seq`: moving only
    // `created_at_ms` left the row behind every row written since.
    expect(rewrite?.text).toContain('seq = DEFAULT');
    expect(batchOf(rewrite)).toEqual(['n-twin']);
    expect(
      statements.some((s) =>
        s.startsWith('INSERT INTO app.user_notifications'),
      ),
    ).toBe(false);
  });
});

describe('the reviewer-designation heads-up (task_reviewer_assigned) [COLLAB-R6]', () => {
  /** Like `fakeDb`, but keeps each statement's VALUES so the row written can
   * be pinned (type, keys, params), not only the statement shape. */
  function recordingDb(answer: (text: string) => Row[]): {
    db: Sql;
    calls: { text: string; values: unknown[] }[];
  } {
    const calls: { text: string; values: unknown[] }[] = [];
    const tag = (
      strings: TemplateStringsArray | readonly string[],
      ...values: unknown[]
    ): unknown => {
      if (!('raw' in strings)) return strings;
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      calls.push({ text, values });
      if (isReaderCheck(text)) return Promise.resolve(readersAsked(values));
      return Promise.resolve(answer(text));
    };
    const db = Object.assign(tag, {
      json: (value: unknown) => value,
      unsafe: (value: string) => value,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js template function
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
    expect(batchOf(insert)).toEqual(['u-recipient']);
    expect(insert?.values).toEqual(
      expect.arrayContaining([
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
    expect(hintsEmitted()).toEqual([bellHintFor('u-recipient')]);
  });

  it('designating yourself rings nothing', async () => {
    const { db, calls } = recordingDb(() => []);
    await notifyTaskReviewerAssigned(db, {
      ...designation,
      reviewerUserId: 'u-actor',
    });
    expect(calls).toEqual([]);
    expect(hintsEmitted()).toEqual([]);
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
    expect(batchOf(insert)).toEqual(['u-recipient']);
    expect(insert?.values).toEqual(
      expect.arrayContaining([
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

describe('the mention bell, per surface [COLLAB-R3]', () => {
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
    const subscriptions = inserts(calls, 'app.task_subscriptions');
    expect(subscriptions.map((call) => call.values.slice(0, 4))).toEqual([
      ['org-1', 'task-1', 'user', 'mention'],
    ]);
    expect(subscriptions.map(batchOf)).toEqual([['u-recipient']]);
    const bells = inserts(calls, 'app.user_notifications');
    expect(bells).toHaveLength(1);
    expect(batchOf(bells[0])).toEqual(['u-recipient']);
    // No comment carries the mention, so the row points at the task.
    expect(bells[0]?.values).toEqual(
      expect.arrayContaining([
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
    expect(hintsEmitted()).toEqual([]);
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
    expect(batchOf(bells[0])).toEqual(['u-recipient']);
    expect(bells[0]?.values).toEqual(
      expect.arrayContaining(['mention', 'comment', 'msg-1']),
    );
  });
});

describe('the paused-schedule notice (automation_failed) [COLLAB-R9]', () => {
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

  it('writes one actionable row per owner and admin who has not muted automation alerts', async () => {
    const fake = fakeDbWithValues((text, values) => {
      if (text.startsWith('SELECT "userId" FROM "member"')) {
        return [{ userId: 'owner-1' }, { userId: 'admin-muted' }];
      }
      if (text.includes('FROM app.notification_preferences')) {
        return preferencesOff(values, ['admin-muted'], 'automation_alerts');
      }
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return [{ id: 'n-1', emailEpoch: 1 }];
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
    expect(batchOf(inserts[0])).toEqual(['owner-1']);
    expect(inserts[0]?.values).toEqual(
      expect.arrayContaining([
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
    expect(addJobsInTx).toHaveBeenCalledWith(fake.db, 'notification.email', [
      {
        payload: { notificationId: 'n-1', epoch: 1 },
        options: { startAfter: expect.any(Date) },
      },
    ]);
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
    expect(vi.mocked(emitHintsInTx).mock.calls.map((call) => call[1])).toEqual([
      [bellHintFor('owner-1'), bellHintFor('admin-1')],
    ]);
  });
});

describe('the agent-question bell (agent_escalation)', () => {
  /** A stand-in that also serves the project lookup's `db.unsafe` column. */
  function fakeAskDb(teamIds: string[]): {
    db: Sql;
    calls: { text: string; values: unknown[] }[];
  } {
    const calls: { text: string; values: unknown[] }[] = [];
    const tag = (
      strings: TemplateStringsArray | readonly string[],
      ...values: unknown[]
    ): unknown => {
      if (!('raw' in strings)) return strings;
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      calls.push({ text, values });
      if (isReaderCheck(text)) return Promise.resolve(readersAsked(values));
      if (text.includes('FROM app.projects')) {
        return Promise.resolve([{ teamIds }]);
      }
      if (text.includes('FROM "member"')) {
        return Promise.resolve([{ userId: 'dev-1' }]);
      }
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return Promise.resolve([{ id: 'n-1' }]);
      }
      return Promise.resolve([]);
    };
    const db = Object.assign(tag, {
      json: (value: unknown) => value,
      unsafe: (value: string) => value,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js template function
    return { db: db as unknown as Sql, calls };
  }

  const ASK = {
    organizationId: 'org-1',
    askId: 'ask-1',
    runId: 'run-1',
    question: 'Which ledger account applies?',
    automationLabel: 'ops/ledger',
  };

  const audience = (calls: { text: string; values: unknown[] }[]) =>
    calls.find(
      (c) => c.text.includes('FROM "member"') && !isReaderCheck(c.text),
    );

  // Only the run page answers a question with no task, and only Owners,
  // Admins and Developers may open it: asking anyone else is a dead end.
  it.each([
    ['an org-wide project', [] as string[]],
    ['a project shared with teams', ['team-1']],
  ])(
    'asks only Owners, Admins and Developers about a run with no task in %s',
    async (_label, teamIds) => {
      const fake = fakeAskDb(teamIds);

      await expect(
        notifyAgentQuestionAsked(fake.db, {
          ...ASK,
          task: null,
          projectId: 'proj-1',
        }),
      ).resolves.toBe(1);

      const members = audience(fake.calls);
      expect(members?.text).toContain(
        `"role" IN ('owner', 'admin', 'developer')`,
      );
      expect(members?.values).toContain(false);
    },
  );

  // A task-bound question is answered on the task, which everyone who can
  // see the project opens.
  it('asks everyone who can see the project about a task-bound run [COLLAB-R7]', async () => {
    const fake = fakeAskDb([]);

    await notifyAgentQuestionAsked(fake.db, {
      ...ASK,
      task: { id: 'task-1', title: 'Book the invoices', projectId: 'proj-1' },
    });

    expect(audience(fake.calls)?.values).toContain(true);
  });

  // The row a project's run with no task writes is the one both links read:
  // the bell and the email open the run, where the question is answered —
  // not the project's board, which has no answer card (#3632).
  it('links a question on a project run with no task to the run, in the bell and the email [NOTIF-R3]', async () => {
    const fake = fakeAskDb([]);

    await notifyAgentQuestionAsked(fake.db, {
      ...ASK,
      task: null,
      projectId: 'proj-1',
    });

    // The writer's columns, after the organization: params is the fifth
    // value, task_id the eighth.
    const insert = fake.calls.find((c) =>
      c.text.startsWith('INSERT INTO app.user_notifications'),
    );
    const params = insert?.values[4];
    if (!isRecord(params)) throw new Error('The question wrote no params');
    expect(insert?.values[7]).toBeNull();
    const run = '/dashboard/org-1/automations/ops__ledger/runs/run-1';
    expect(
      notificationTargetPath(
        personalNotificationTarget({
          organizationId: 'org-1',
          taskId: undefined,
          params,
        }),
      ),
    ).toBe(run);
    expect(
      buildPersonalNotificationUrl({
        organizationId: 'org-1',
        params,
        siteUrl: 'https://app.example.com',
      }),
    ).toBe(`https://app.example.com${run}`);
  });
});

describe('the failed-run notice (agent_run_failed) [COLLAB-R8]', () => {
  interface World {
    /** Unmuted watchers of the task. */
    subscribers: string[];
    /** Who is still a member able to open the project. */
    readers: string[];
    /** Recipients who switched agent escalations off. */
    muted?: string[];
  }

  /** Serves the reads the notice makes; `db(list)` returns the list, so the
   * member filter can be answered from the ids it was asked about. */
  function fakeRunDb(world: World): {
    db: Sql;
    calls: { text: string; values: unknown[] }[];
  } {
    const calls: { text: string; values: unknown[] }[] = [];
    let nextId = 0;
    const tag = (
      strings: TemplateStringsArray | readonly string[],
      ...values: unknown[]
    ): unknown => {
      if (!('raw' in strings)) return strings;
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      calls.push({ text, values });
      if (text.includes('FROM app.task_subscriptions')) {
        return Promise.resolve(
          world.subscribers.map((subscriberId) => ({ subscriberId })),
        );
      }
      if (isReaderCheck(text)) {
        return Promise.resolve(readersAsked(values, world.readers));
      }
      if (text.includes('FROM app.notification_preferences')) {
        return Promise.resolve(
          preferencesOff(values, world.muted, 'escalation'),
        );
      }
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return Promise.resolve(
          batchOf({ values }).map(() => {
            nextId += 1;
            return { id: `n-${nextId}`, emailEpoch: 1 };
          }),
        );
      }
      return Promise.resolve([]);
    };
    const db = Object.assign(tag, {
      json: (value: unknown) => value,
      unsafe: (value: string) => value,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js template function
    return { db: db as unknown as Sql, calls };
  }

  const TASK = {
    id: 'task-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    title: 'Compare the two offers',
  };

  const inserts = (calls: { text: string; values: unknown[] }[]) =>
    calls.filter((c) =>
      c.text.startsWith('INSERT INTO app.user_notifications'),
    );

  it('tells the starter and the watchers who can still open the project, by email too', async () => {
    const fake = fakeRunDb({
      subscribers: ['watcher-1', 'left-org'],
      readers: ['member-starter', 'watcher-1'],
    });

    await expect(
      notifyAgentRunFailed(fake.db, {
        task: TASK,
        agentId: 'agent-1',
        starterUserId: 'member-starter',
        failureCode: 'harness_error',
      }),
    ).resolves.toBe(2);

    // One reader check over the whole candidate list for the project, then
    // the writer's own, once for every row it writes.
    expect(fake.calls.filter((c) => isReaderCheck(c.text))).toHaveLength(2);
    const members = fake.calls.find((c) => isReaderCheck(c.text));
    expect(members?.text).toContain(`lower(m."role") <> 'disabled'`);
    expect(members?.values).toEqual(
      expect.arrayContaining([
        'org-1',
        'proj-1',
        expect.arrayContaining(['watcher-1', 'left-org', 'member-starter']),
      ]),
    );
    const rows = inserts(fake.calls);
    expect(rows.map(batchOf)).toEqual([['watcher-1', 'member-starter']]);
    expect(rows[0]?.values).toEqual(
      expect.arrayContaining([
        'org-1',
        'agent_run_failed',
        'agentRunFailed',
        'agentRunFailedBody',
        { title: 'Compare the two offers', projectId: 'proj-1' },
        'task',
        'task-1',
        'agent',
        'agent-1',
      ]),
    );
    // Actionable: each row leaves the app as an email.
    expect(emailsQueued()).toEqual([
      { notificationId: 'n-1', epoch: 1 },
      { notificationId: 'n-2', epoch: 1 },
    ]);
  });

  it('reads a team project’s audience through its teams, admins always', async () => {
    const fake = fakeRunDb({
      subscribers: ['watcher-1'],
      readers: ['watcher-1'],
    });

    await notifyAgentRunFailed(fake.db, {
      task: TASK,
      agentId: 'agent-1',
      starterUserId: null,
      failureCode: null,
    });

    const members = fake.calls.find((c) => isReaderCheck(c.text));
    expect(members?.text).toContain(`lower(m."role") IN ('owner', 'admin')`);
    expect(members?.text).toContain('FROM "teamMember" tm');
    expect(members?.text).toContain('tm."teamId" = ANY (audience."teamIds")');
  });

  it.each([
    ['budget_exceeded', 'agentRunFailedBudgetBody'],
    ['policy_refused', 'agentRunFailedPolicyBody'],
    ['agent_model_missing', 'agentRunFailedSetupBody'],
    ['equipment_missing', 'agentRunFailedSetupBody'],
    ['input_missing', 'agentRunFailedInputBody'],
    ['deadline', 'agentRunFailedBody'],
    ['start_failed', 'agentRunFailedBody'],
    [null, 'agentRunFailedBody'],
    ['a-code-from-a-newer-build', 'agentRunFailedBody'],
  ])('words a %s failure with %s', async (failureCode, bodyKey) => {
    const fake = fakeRunDb({ subscribers: [], readers: ['member-starter'] });

    await notifyAgentRunFailed(fake.db, {
      task: TASK,
      agentId: 'agent-1',
      starterUserId: 'member-starter',
      failureCode,
    });

    expect(inserts(fake.calls)[0]?.values).toContain(bodyKey);
  });

  it('leaves out whoever switched agent escalations off', async () => {
    const fake = fakeRunDb({
      subscribers: ['watcher-1'],
      readers: ['member-starter', 'watcher-1'],
      muted: ['watcher-1'],
    });

    await notifyAgentRunFailed(fake.db, {
      task: TASK,
      agentId: 'agent-1',
      starterUserId: 'member-starter',
      failureCode: 'turn_crashed',
    });

    expect(
      fake.calls.find((c) =>
        c.text.includes('FROM app.notification_preferences'),
      )?.text,
    ).toContain('escalation');
    expect(inserts(fake.calls).flatMap(batchOf)).toEqual(['member-starter']);
  });

  it('asks nobody about membership when nobody is left to tell', async () => {
    const fake = fakeRunDb({ subscribers: [], readers: [] });

    await expect(
      notifyAgentRunFailed(fake.db, {
        task: TASK,
        agentId: 'agent-1',
        starterUserId: null,
        failureCode: 'deadline',
      }),
    ).resolves.toBe(0);

    expect(fake.calls.some((c) => isReaderCheck(c.text))).toBe(false);
    expect(inserts(fake.calls)).toHaveLength(0);
  });

  it('a new run marks the task’s unread notices read and hints each recipient', async () => {
    const dismiss = fakeDb((text) =>
      text.startsWith('UPDATE app.user_notifications SET read = true')
        ? [{ userId: 'member-starter' }]
        : [],
    );

    await expect(
      dismissAgentRunFailedNotifications(dismiss.db, {
        organizationId: 'org-1',
        taskId: 'task-1',
      }),
    ).resolves.toBe(1);

    expect(dismiss.statements[0]).toContain(
      "type = 'agent_run_failed' AND read = false AND task_id = ?",
    );
    expect(hintsEmitted()).toEqual([bellHintFor('member-starter')]);
  });
});

describe('the message an automation step sends (automation_message) [COLLAB-R13]', () => {
  type Call = { text: string; values: unknown[] };
  /** The run's earlier rows, as `{ userId, deliveryKey }`. */
  function fakeTx(args: {
    sent?: { userId: string; deliveryKey: string }[];
    muted?: readonly string[];
  }): { tx: TransactionSql; calls: Call[] } {
    const calls: Call[] = [];
    let inserted = 0;
    const tag = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<Row[]> => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      calls.push({ text, values });
      if (text.includes("params->>'deliveryKey'")) {
        return Promise.resolve(args.sent ?? []);
      }
      if (text.includes('FROM app.notification_preferences')) {
        return Promise.resolve(
          preferencesOff(values, args.muted, 'automation_messages'),
        );
      }
      if (text.startsWith('INSERT INTO app.user_notifications')) {
        return Promise.resolve(
          batchOf({ values }).map(() => {
            inserted += 1;
            return { id: `n-${inserted}`, emailEpoch: 1 };
          }),
        );
      }
      return Promise.resolve([]);
    };
    const tx = Object.assign(tag, { json: (value: unknown) => value });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js transaction
    return { tx: tx as unknown as TransactionSql, calls };
  }

  const SEND = {
    organizationId: 'org-1',
    runId: 'run-1',
    deliveryKey: 'run-1/tell/0/0',
    userIds: ['u-ada', 'u-noah', 'u-ada', 'u-mia'],
    automation: 'reports/weekly',
    title: 'Weekly report ready',
    message: 'Revenue is up 4 %.',
    link: '/dashboard/org-1/documents',
    runCap: 100,
  };
  const inserts = (calls: Call[]) =>
    calls.filter((call) =>
      call.text.startsWith('INSERT INTO app.user_notifications'),
    );

  it('writes one actionable row per recipient who has not muted automation messages', async () => {
    const { tx, calls } = fakeTx({ muted: ['u-noah'] });
    await expect(notifyAutomationMessage(tx, SEND)).resolves.toEqual({
      ok: true,
      delivered: ['u-ada', 'u-mia'],
      muted: ['u-noah'],
    });
    // The run's lock comes first: its steps' sends are counted one at a time.
    expect(calls[0]?.text).toContain('pg_advisory_xact_lock');
    expect(calls[0]?.values).toEqual(['automation-messages:org-1:run-1']);
    // The preference read names the column the toggle writes.
    expect(
      calls.find((c) => c.text.includes('FROM app.notification_preferences'))
        ?.text,
    ).toContain('automation_messages');
    const rows = inserts(calls);
    expect(rows.map(batchOf)).toEqual([['u-ada', 'u-mia']]);
    expect(rows[0]?.values).toEqual(
      expect.arrayContaining([
        'org-1',
        'automation_message',
        'automationMessage',
        'automationMessageBody',
        {
          automation: 'reports/weekly',
          runId: 'run-1',
          title: 'Weekly report ready',
          message: 'Revenue is up 4 %.',
          link: '/dashboard/org-1/documents',
          deliveryKey: 'run-1/tell/0/0',
        },
        'automation_run',
        'run-1',
        'system',
      ]),
    );
    // Each message is news: it never collapses into another row (its
    // coalesce key, the twelfth value, is NULL).
    expect(rows[0]?.values[11]).toBeNull();
    // Actionable: it leaves the app by email too.
    expect(emailsQueued()).toHaveLength(2);
  });

  it('a retry of the same step execution writes nothing twice', async () => {
    const { tx, calls } = fakeTx({
      sent: [
        { userId: 'u-ada', deliveryKey: 'run-1/tell/0/0' },
        { userId: 'u-mia', deliveryKey: 'run-1/tell/0/0' },
        { userId: 'u-ada', deliveryKey: 'run-1/tell/1/0' },
      ],
      // Muting since the first try does not take back what was sent.
      muted: ['u-noah', 'u-mia'],
    });
    await expect(notifyAutomationMessage(tx, SEND)).resolves.toEqual({
      ok: true,
      delivered: ['u-ada', 'u-mia'],
      muted: ['u-noah'],
    });
    expect(inserts(calls)).toEqual([]);
  });

  it('writes nothing when the run would pass its cap', async () => {
    const { tx, calls } = fakeTx({
      sent: Array.from({ length: 99 }, (_, at) => ({
        userId: `u-${at}`,
        deliveryKey: `run-1/earlier/${at}/0`,
      })),
    });
    await expect(notifyAutomationMessage(tx, SEND)).resolves.toEqual({
      ok: false,
      sent: 99,
    });
    expect(inserts(calls)).toEqual([]);
  });

  it('frames a message without words of its own', async () => {
    const { tx, calls } = fakeTx({});
    const { message: _message, link: _link, ...bare } = SEND;
    await notifyAutomationMessage(tx, { ...bare, userIds: ['u-ada'] });
    const row = inserts(calls)[0];
    expect(row?.values).toContain('automationMessageBodyNoText');
    expect(row?.values).toContainEqual({
      automation: 'reports/weekly',
      runId: 'run-1',
      title: 'Weekly report ready',
      deliveryKey: 'run-1/tell/0/0',
    });
  });
});

describe('a fan-out costs the same round trips for one person as for many (#4712)', () => {
  /** One row of the stand-in's `app.user_notifications`. */
  interface StoredRow {
    id: string;
    seq: number;
    userId: string;
    organizationId: string;
    type: string;
    params: unknown;
    resourceId: string;
    coalesceKey: string | null;
    read: boolean;
    emailEpoch: number;
  }

  interface World {
    /** Who can open the task now; everyone asked when left out. */
    readers?: readonly string[];
    /** Who switched every kind of notification off. */
    muted?: readonly string[];
    /** The task's unmuted watchers. */
    watchers?: readonly string[];
    /** The members the audience reads list (owners, a team, a project). */
    members?: readonly string[];
    /** The bell's rows before the fan-out, oldest first. */
    rows?: readonly Omit<StoredRow, 'seq'>[];
  }

  /** Every switch the preference read selects, switched off. */
  const ALL_OFF = Object.fromEntries(
    [
      'task_assigned',
      'task_status_changed',
      'task_commented',
      'mention',
      'task_deadlines',
      'escalation',
      'automation_alerts',
      'conversation_messages',
      'automation_messages',
    ].map((column) => [column, false]),
  );

  /**
   * A stand-in that keeps `app.user_notifications` the way the writer's
   * statements change it — the twin scan over each person's 100 newest
   * unread rows, the rewrite's fresh `seq` and epoch step, the insert's
   * first epoch, the delete — and answers the fan-outs' other reads from
   * `world`.
   */
  function bellStore(world: World): {
    db: TransactionSql;
    rows: StoredRow[];
    calls: { text: string; values: unknown[] }[];
  } {
    let seq = 0;
    let nextId = 0;
    // Copies: two stores of one world must not share their rows.
    const rows: StoredRow[] = (world.rows ?? []).map((row) =>
      Object.assign({ seq: ++seq }, row),
    );
    const calls: { text: string; values: unknown[] }[] = [];
    const text = (value: unknown): string => String(value);
    const list = (value: unknown): string[] =>
      Array.isArray(value) ? value.map(text) : [];
    const answer = (sql: string, values: unknown[]): Row[] => {
      if (isReaderCheck(sql)) return readersAsked(values, world.readers);
      if (sql.includes('FROM app.notification_preferences')) {
        return list(values.find(Array.isArray))
          .filter((userId) => world.muted?.includes(userId) === true)
          .map((userId) => Object.assign({ userId }, ALL_OFF));
      }
      if (isTwinScan(sql)) {
        // unnest(asked), org, LIMIT, key — in that order.
        const [asked, organizationId, cap, key] = values;
        return list(asked).flatMap((userId) => {
          const twin = rows
            .filter(
              (row) =>
                row.userId === userId &&
                row.organizationId === organizationId &&
                !row.read,
            )
            .sort((a, b) => b.seq - a.seq)
            .slice(0, Number(cap))
            .find((row) => row.coalesceKey === key);
          return twin === undefined ? [] : [{ userId, id: twin.id }];
        });
      }
      if (sql.startsWith('DELETE FROM app.user_notifications')) {
        const gone = list(values[0]);
        rows.splice(
          0,
          rows.length,
          ...rows.filter((row) => !gone.includes(row.id)),
        );
        return [];
      }
      if (sql.startsWith('UPDATE app.user_notifications SET type')) {
        // type, keys, params, resource, task, actor, now, epoch step, ids.
        const ids = list(values.at(-1));
        return rows
          .filter((row) => ids.includes(row.id))
          .map((row) => {
            row.type = text(values[0]);
            row.params = values[3];
            row.resourceId = text(values[5]);
            row.seq = ++seq;
            row.emailEpoch += Number(values[10]);
            return { id: row.id, emailEpoch: row.emailEpoch };
          });
      }
      if (sql.startsWith('INSERT INTO app.user_notifications')) {
        // org, type, keys, params, resource, task, actor, now, key, epoch,
        // recipients.
        return list(values.at(-1)).map((userId) => {
          const row: StoredRow = {
            id: `n-${++nextId}`,
            seq: ++seq,
            userId,
            organizationId: text(values[0]),
            type: text(values[1]),
            params: values[4],
            resourceId: text(values[6]),
            coalesceKey: values[11] === null ? null : text(values[11]),
            read: false,
            emailEpoch: Number(values[12]),
          };
          rows.push(row);
          return { id: row.id, emailEpoch: row.emailEpoch };
        });
      }
      if (sql.includes('FROM app.task_subscriptions')) {
        return (world.watchers ?? []).map((subscriberId) => ({
          subscriberId,
        }));
      }
      if (sql.startsWith('SELECT "name", "email" FROM "user"')) {
        return [{ name: 'Ada', email: 'ada@example.com' }];
      }
      if (sql.includes('FROM app.projects')) return [{ teamIds: [] }];
      if (sql.includes('FROM "member"') || sql.includes('FROM "teamMember"')) {
        return (world.members ?? []).map((userId) => ({ userId }));
      }
      return [];
    };
    const tag = (
      strings: TemplateStringsArray | readonly string[],
      ...values: unknown[]
    ): unknown => {
      if (!('raw' in strings)) return strings;
      const sql = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      calls.push({ text: sql, values });
      return Promise.resolve(answer(sql, values));
    };
    const db = Object.assign(tag, {
      json: (value: unknown) => value,
      unsafe: (value: string) => value,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js transaction
    return { db: db as unknown as TransactionSql, rows, calls };
  }

  /** Statements, and the hint and email batches the writes handed over:
   * every round trip the writer's transaction waits on. */
  function roundTrips(calls: readonly unknown[]): number {
    return (
      calls.length +
      vi.mocked(emitHintInTx).mock.calls.length +
      vi.mocked(emitHintsInTx).mock.calls.length +
      vi.mocked(addJobInTx).mock.calls.length +
      vi.mocked(addJobsInTx).mock.calls.length
    );
  }

  function clearHandOvers(): void {
    vi.mocked(emitHintInTx).mockClear();
    vi.mocked(emitHintsInTx).mockClear();
    vi.mocked(addJobInTx).mockClear();
    vi.mocked(addJobsInTx).mockClear();
  }

  const TASK = {
    id: 'task-1',
    organizationId: 'org-1',
    projectId: 'proj-1',
    title: 'Compare the two offers',
  };

  /** Every emitter that tells several people at once, telling `people`. */
  const FAN_OUTS: [
    string,
    (people: string[]) => World,
    (db: TransactionSql, people: string[]) => Promise<unknown>,
  ][] = [
    [
      'a comment, to its watchers and to the people it names',
      (people) => ({ watchers: people }),
      (db, people) =>
        notifyTaskComment(db, {
          task: TASK,
          commentId: 'msg-1',
          mentions: people.map((id) => ({ type: 'user', id: `${id}-named` })),
          actorType: 'user',
          actorId: 'u-actor',
        }),
    ],
    [
      'a description that names people',
      () => ({}),
      (db, people) =>
        notifyTaskMentions(db, {
          task: TASK,
          mentions: people.map((id) => ({ type: 'user', id })),
          actorType: 'user',
          actorId: 'u-actor',
        }),
    ],
    [
      'a status change, to the watchers',
      (people) => ({ watchers: people }),
      (db) =>
        notifyTaskStatusChanged(db, {
          task: TASK,
          fromStatus: 'todo',
          toStatus: 'done',
          actorType: 'user',
          actorId: 'u-actor',
        }),
    ],
    [
      'a failed agent run, to the watchers',
      (people) => ({ watchers: people }),
      (db) =>
        notifyAgentRunFailed(db, {
          task: TASK,
          agentId: 'agent-1',
          starterUserId: null,
          failureCode: 'deadline',
        }),
    ],
    [
      'an agent’s question on a task, to the project’s people',
      (people) => ({ members: people }),
      (db) =>
        notifyAgentQuestionAsked(db, {
          organizationId: 'org-1',
          askId: 'ask-1',
          runId: 'run-1',
          question: 'Which ledger account applies?',
          automationLabel: 'ops/ledger',
          task: { id: 'task-1', title: TASK.title, projectId: 'proj-1' },
        }),
    ],
    [
      'a schedule that paused itself, to the owners and admins',
      (people) => ({ members: people }),
      (db) =>
        notifyTriggerPaused(db, {
          organizationId: 'org-1',
          triggerId: 'trg-1',
          name: 'ops/nightly',
          failures: 5,
          code: 'connector_error',
        }),
    ],
    [
      'an automation’s message, to the members it names',
      () => ({}),
      (db, people) =>
        notifyAutomationMessage(db, {
          organizationId: 'org-1',
          runId: 'run-1',
          deliveryKey: 'run-1/tell/0/0',
          userIds: people,
          automation: 'reports/weekly',
          title: 'Weekly report ready',
          runCap: 100,
        }),
    ],
    [
      'a conversation queued to a team, to its members',
      (people) => ({ members: people }),
      (db) =>
        notifyConversationAssignedTeam(db, {
          conversation: {
            id: 'conv-1',
            organizationId: 'org-1',
            subject: 'Invoice',
            status: 'open',
          },
          teamId: 'team-1',
          actorUserId: 'u-actor',
        }),
    ],
  ];

  it.each(FAN_OUTS)(
    '%s costs as many round trips for 25 people as for one',
    async (_label, worldOf, notify) => {
      const told = async (count: number) => {
        clearHandOvers();
        const people = Array.from({ length: count }, (_, at) => `p-${at}`);
        const store = bellStore(worldOf(people));
        await notify(store.db, people);
        return { trips: roundTrips(store.calls), rows: store.rows.length };
      };
      const one = await told(1);
      const many = await told(25);

      expect(one.rows).toBeGreaterThan(0);
      expect(many.rows).toBe(25 * one.rows);
      expect(many.trips).toBe(one.trips);
    },
  );

  it('gives everyone a comment concerns a row of their own, their email and their hint', async () => {
    const watchers = Array.from({ length: 25 }, (_, at) => `w-${at}`);
    const named = Array.from({ length: 5 }, (_, at) => `m-${at}`);
    const store = bellStore({ watchers: [...watchers, 'u-actor'] });

    await notifyTaskComment(store.db, {
      task: TASK,
      commentId: 'msg-1',
      mentions: named.map((id) => ({ type: 'user', id })),
      actorType: 'user',
      actorId: 'u-actor',
    });

    const told = (type: string) =>
      store.rows
        .filter((row) => row.type === type && row.resourceId === 'msg-1')
        .map((row) => row.userId);
    // The commenter is told nothing; the people named get the mention, not
    // the comment as well.
    expect(told('task_commented')).toEqual(watchers);
    expect(told('mention')).toEqual(named);
    // A mention is actionable: each named person's own row is emailed.
    expect(emailsQueued()).toEqual(
      store.rows
        .filter((row) => row.type === 'mention')
        .map((row) => ({ notificationId: row.id, epoch: 1 })),
    );
    // Each bell hint is narrowed to its own person.
    expect(hintsEmitted()).toEqual(
      [...named, ...watchers].map((userId) => bellHintFor(userId)),
    );
  });

  it('leaves out only the people who switched the kind off', async () => {
    const watchers = ['w-1', 'w-2', 'w-3', 'w-4', 'w-5'];
    const store = bellStore({ watchers, muted: ['w-2', 'w-4'] });

    await notifyTaskStatusChanged(store.db, {
      task: TASK,
      fromStatus: 'todo',
      toStatus: 'done',
      actorType: 'agent',
      actorId: 'agent-1',
    });

    const preferences = store.calls.filter((call) =>
      call.text.includes('FROM app.notification_preferences'),
    );
    expect(preferences).toHaveLength(1);
    expect(preferences[0]?.text).toContain('user_id = ANY(?::text[])');
    expect(store.rows.map((row) => row.userId)).toEqual(['w-1', 'w-3', 'w-5']);
    expect(hintsEmitted().map((hint) => hint.userId)).toEqual([
      'w-1',
      'w-3',
      'w-5',
    ]);
  });

  /** A row as the bell shows it, whatever its id and place. */
  const shown = (rows: readonly StoredRow[]) =>
    rows
      .map(({ id: _id, seq: _seq, ...row }) => row)
      .sort((a, b) =>
        `${a.userId}/${a.type}`.localeCompare(`${b.userId}/${b.type}`),
      );

  /** Each queued email, by whose row it carries. */
  const emailedTo = (rows: readonly StoredRow[]) =>
    Object.fromEntries(
      emailsQueued().map((payload) => {
        const job = isRecord(payload) ? payload : undefined;
        const row = rows.find(
          (candidate) => candidate.id === job?.notificationId,
        );
        return [row?.userId ?? 'nobody', job?.epoch];
      }),
    );

  const unread = (
    userId: string,
    id: string,
    type: string,
    coalesceKey: string | null,
  ): Omit<StoredRow, 'seq'> => ({
    id,
    userId,
    organizationId: 'org-1',
    type,
    params: { title: TASK.title, projectId: 'proj-1' },
    resourceId: 'task-1',
    coalesceKey,
    read: false,
    emailEpoch: 1,
  });

  it('writes, rewrites and withholds for many at once exactly as one at a time', async () => {
    const failure = {
      organizationId: 'org-1',
      type: 'agent_run_failed',
      titleKey: 'agentRunFailed',
      bodyKey: 'agentRunFailedBody',
      params: { title: TASK.title, projectId: 'proj-1' },
      resourceType: 'task',
      resourceId: 'task-1',
      taskId: 'task-1',
      actorType: 'agent',
      actorId: 'agent-1',
    } as const;
    const key = 'task:task-1:agent_run';
    const world: World = {
      readers: ['u-rewrite', 'u-read', 'u-deep', 'u-fresh'],
      rows: [
        // An unread twin: rewritten in place.
        unread('u-rewrite', 'n-twin', 'agent_run_failed', key),
        // A twin already read is history: a new row.
        { ...unread('u-read', 'n-read', 'agent_run_failed', key), read: true },
        // A twin behind 100 newer unread rows is out of reach: a new row.
        unread('u-deep', 'n-deep', 'agent_run_failed', key),
        ...Array.from({ length: 100 }, (_, at) =>
          unread('u-deep', `n-later-${at}`, 'task_commented', null),
        ),
      ],
    };
    const people = ['u-rewrite', 'u-read', 'u-deep', 'u-fresh', 'u-gone'];

    clearHandOvers();
    const batch = bellStore(world);
    const outcomes = await writeCoalescedNotifications(
      batch.db,
      failure,
      people,
    );
    const batchEmails = emailedTo(batch.rows);
    const batchHints = hintsEmitted();
    const batchTrips = roundTrips(batch.calls);

    clearHandOvers();
    const single = bellStore(world);
    const oneByOne = new Map<string, string>();
    for (const userId of people) {
      oneByOne.set(
        userId,
        await writeCoalescedNotification(single.db, { ...failure, userId }),
      );
    }

    expect(Object.fromEntries(outcomes)).toEqual({
      'u-rewrite': 'rewritten',
      'u-read': 'inserted',
      'u-deep': 'inserted',
      'u-fresh': 'inserted',
      'u-gone': 'withheld',
    });
    expect(outcomes).toEqual(oneByOne);
    expect(shown(batch.rows)).toEqual(shown(single.rows));
    // The twin keeps its id and takes a place newer than every row there
    // was before (the seeded rows hold the first places).
    const twin = batch.rows.find((row) => row.id === 'n-twin');
    expect(twin?.seq).toBeGreaterThan(world.rows?.length ?? Infinity);
    // Its email epoch moved past the queued one; new rows start at 1.
    expect(batchEmails).toEqual({
      'u-rewrite': 2,
      'u-read': 1,
      'u-deep': 1,
      'u-fresh': 1,
    });
    expect(emailedTo(single.rows)).toEqual(batchEmails);
    expect(batchHints).toEqual(hintsEmitted());
    expect(batchHints.map((hint) => hint.userId)).toEqual([
      'u-rewrite',
      'u-read',
      'u-deep',
      'u-fresh',
    ]);
    expect(batchTrips).toBeLessThan(roundTrips(single.calls));
  });

  it('cancels for many at once exactly as one at a time', async () => {
    const unassignment = {
      organizationId: 'org-1',
      type: 'task_unassigned',
      titleKey: 'taskUnassigned',
      bodyKey: 'taskUnassignedBody',
      params: { title: TASK.title, projectId: 'proj-1' },
      resourceType: 'task',
      resourceId: 'task-1',
      taskId: 'task-1',
      actorType: 'user',
      actorId: 'u-actor',
      undoes: true,
    } as const;
    const world: World = {
      rows: [
        unread(
          'u-assigned',
          'n-assigned',
          'task_assigned',
          'task:task-1:assignment',
        ),
      ],
    };
    const people = ['u-assigned', 'u-never'];

    const batch = bellStore(world);
    const outcomes = await writeCoalescedNotifications(
      batch.db,
      unassignment,
      people,
    );
    const batchHints = hintsEmitted();
    clearHandOvers();
    const single = bellStore(world);
    for (const userId of people) {
      await writeCoalescedNotification(single.db, { ...unassignment, userId });
    }

    // The unread assignment and its undo drop together; with no twin left
    // to undo, the undo is news of its own.
    expect(Object.fromEntries(outcomes)).toEqual({
      'u-assigned': 'cancelled',
      'u-never': 'inserted',
    });
    expect(batch.rows.map((row) => [row.userId, row.type])).toEqual([
      ['u-never', 'task_unassigned'],
    ]);
    expect(shown(batch.rows)).toEqual(shown(single.rows));
    // Losing work needs no action: no email either way.
    expect(emailsQueued()).toEqual([]);
    expect(batchHints).toEqual(hintsEmitted());
    expect(batchHints.map((hint) => hint.userId)).toEqual([
      'u-assigned',
      'u-never',
    ]);
  });
});
