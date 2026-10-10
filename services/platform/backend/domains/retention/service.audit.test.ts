// @vitest-environment node

/**
 * The cleanup's audit trail. Each org run appends `retention.run_started`,
 * one `<entity>.retention_deleted` row per category that destroyed anything
 * — with its counts, never one row per record — and a closing
 * `retention.run_completed` or `retention.run_failed`. A plain-SQL category
 * writes its row inside the transaction that deleted its rows; a purge lane
 * writes it once its per-record transactions are through. The double
 * records which transaction every statement and every audit append ran in,
 * so "the same transaction" is a checked fact rather than a hope.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import type { CreateAuditLogArgs } from '../audit_logs/types.ts';
import { releaseRefs } from '../knowledge/release.ts';
import { loadActiveHolds } from '../legal_holds/service.ts';
import {
  CHAT_FILTER_EVENT_MAX_BATCHES,
  runRetentionCleanup,
  sweepOrgPhase2,
} from './service.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../knowledge/release.ts', () => ({ releaseRefs: vi.fn() }));
vi.mock('../legal_holds/service.ts', () => ({ loadActiveHolds: vi.fn() }));
vi.mock('../audit_logs/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../audit_logs/service.ts')>()),
  createAuditLog: vi.fn(),
}));
vi.mock('../tts/service.ts', () => ({ cascadeDeleteThreadTtsChunks: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
  /** The transaction it ran in; null for an autocommit statement. */
  tx: number | null;
}

/** Answers for the statements whose folded text starts with a key. A
 * function sees the statement's values and may throw. */
type Script = Record<string, unknown[] | ((values: unknown[]) => unknown[])>;

const FRAGMENT = Symbol('fragment');
const TX_ID = Symbol('txId');

interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/**
 * A recorder that inlines nested `sql\`…\`` fragments the way postgres.js
 * does and hands every `begin` callback a handle of its own, numbered, so a
 * statement and an audit append can be traced to their transaction.
 */
function fakeSql(script: Script): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  let transactions = 0;
  const handle = (tx: number | null): unknown => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = '';
      const flat: unknown[] = [];
      strings.forEach((part, index) => {
        text += part;
        if (index >= values.length) return;
        const value = values[index];
        if (isFragment(value)) {
          text += value.text;
          flat.push(...value.values);
        } else {
          text += '?';
          flat.push(value);
        }
      });
      text = text.replace(/\s+/g, ' ').trim();
      statements.push({ text, values: flat, tx });
      const key = Object.keys(script).find((prefix) => text.startsWith(prefix));
      const answer = key === undefined ? [] : script[key];
      let rows: Promise<unknown[]>;
      try {
        rows = Promise.resolve(
          typeof answer === 'function' ? answer(flat) : answer,
        );
      } catch (error) {
        rows = Promise.reject(error);
      }
      const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
      return Object.assign(rows, fragment);
    };
    return Object.assign(tag, {
      [TX_ID]: tx,
      begin: (callback: (inner: unknown) => unknown) =>
        Promise.resolve(callback(handle(++transactions))),
      json: (value: unknown) => value,
      unsafe: (text: string): Fragment => ({
        [FRAGMENT]: true,
        text,
        values: [],
      }),
    });
  };
  return { sql: handle(null) as unknown as Sql, statements };
}

/** Every audit append, with the transaction it was made in. */
function appended(): { tx: number | null; row: CreateAuditLogArgs }[] {
  return vi.mocked(createAuditLog).mock.calls.map(([tx, row]) => ({
    tx: (tx as unknown as { [TX_ID]: number | null })[TX_ID],
    row,
  }));
}

function actions(): string[] {
  return appended().map((call) => call.row.action);
}

function appendOf(action: string) {
  const calls = appended().filter((call) => call.row.action === action);
  expect(calls, `one ${action} append`).toHaveLength(1);
  const [call] = calls;
  if (call === undefined) throw new Error(`no ${action} append`);
  return call;
}

function txOf(statements: Statement[], prefix: string): number | null {
  const statement = statements.find((s) => s.text.startsWith(prefix));
  if (statement === undefined) throw new Error(`no statement ${prefix}`);
  return statement.tx;
}

/** The fleet read plus the applied bounds `clampedPolicyFor` needs; empty
 * bounds clamp nothing, so the policy runs as written. */
function orgRun(script: Script = {}): Script {
  return {
    'SELECT org_id AS id FROM app.retention_applied_bounds': [{ id: 'org_1' }],
    'SELECT bounds, applied_at_ms': [
      { bounds: {}, appliedAt: 1, rejectedBoundsHash: null },
    ],
    ...script,
  };
}

function givenPolicy(config: Record<string, unknown>): void {
  vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
    documentsRetentionDays: 30,
    ...config,
  } as never);
}

const DAY_MS = 24 * 60 * 60 * 1000;

const ids = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }));

beforeEach(() => {
  // Reset, not clear: a test that makes an append or a release fail must not
  // leave that behaviour behind for the next one.
  vi.mocked(createAuditLog).mockReset();
  vi.mocked(readGovernancePolicyForOrg).mockReset();
  vi.mocked(loadActiveHolds).mockReset().mockResolvedValue({
    orgHeld: false,
    userMembershipIds: new Set(),
  });
  vi.mocked(releaseRefs).mockReset().mockResolvedValue({
    released: [],
    kept: [],
    failures: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runRetentionCleanup — the run audit trail', () => {
  it('writes one row per plain-SQL category inside the transaction that deleted its rows [RETAIN-R6]', async () => {
    givenPolicy({
      messageFeedbackEnabled: true,
      messageFeedbackRetentionDays: 30,
      notificationsEnabled: true,
      notificationsRetentionDays: 30,
    });
    const fake = fakeSql(
      orgRun({
        'DELETE FROM app.message_feedback': ids(3, 'feedback-'),
        'DELETE FROM app.notifications': ids(1, 'bell-'),
        'DELETE FROM app.user_notifications': ids(2, 'user-bell-'),
      }),
    );

    await runRetentionCleanup(fake.sql);

    // Three records, one row: never a row per destroyed record.
    expect(actions()).toEqual([
      'retention.run_started',
      'message_feedback.retention_deleted',
      'notification.retention_deleted',
      'retention.run_completed',
    ]);
    const feedback = appendOf('message_feedback.retention_deleted');
    expect(feedback.tx).not.toBeNull();
    expect(feedback.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.message_feedback'),
    );
    expect(feedback.row.metadata).toEqual({
      category: 'messageFeedback',
      deleted: 3,
    });
    const bells = appendOf('notification.retention_deleted');
    expect(bells.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.notifications'),
    );
    expect(bells.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.user_notifications'),
    );
    expect(bells.row.metadata).toEqual({
      category: 'notifications',
      deleted: 3,
      counts: { notifications: 1, userNotifications: 2 },
    });

    // One frame for the whole run: the system actor, the data category, and
    // the run's id on every row.
    const runIds = new Set(appended().map((call) => call.row.resourceId));
    expect(runIds.size).toBe(1);
    for (const { row } of appended()) {
      expect(row).toMatchObject({
        organizationId: 'org_1',
        actorId: 'system',
        actorType: 'system',
        category: 'data',
        resourceType: 'retention_run',
      });
      expect(row.resourceId).toMatch(/^[0-9a-f-]{36}$/);
    }
    const completed = appendOf('retention.run_completed');
    expect(completed.row.status).toBe('success');
    expect(completed.row.metadata).toMatchObject({
      deleted: 6,
      categories: {
        messageFeedback: { deleted: 3 },
        notifications: { deleted: 3 },
      },
    });
  });

  it('deletes guardrail events past the window plus the grace, held owners’ events filtered in SQL, its row in the delete’s transaction', async () => {
    givenPolicy({
      chatFilterEventsEnabled: true,
      chatFilterEventsRetentionDays: 30,
      deletionGraceDays: 7,
    });
    vi.mocked(loadActiveHolds).mockResolvedValue({
      orgHeld: false,
      userMembershipIds: new Set(['held-1']),
    });
    const fake = fakeSql(
      orgRun({ 'DELETE FROM app.chat_filter_events': ids(4, 'event-') }),
    );
    const before = Date.now();

    const results = await runRetentionCleanup(fake.sql);

    expect(results.org_1?.chatFilterEvents).toBe(4);
    expect(actions()).toEqual([
      'retention.run_started',
      'chat_filter_event.retention_deleted',
      'retention.run_completed',
    ]);
    const deletes = fake.statements.filter((s) =>
      s.text.startsWith('DELETE FROM app.chat_filter_events'),
    );
    expect(deletes).toHaveLength(1);
    const [statement] = deletes;
    // Older than the window plus the grace, in this org, a batch at a time.
    expect(statement?.text).toContain('e.org_id = ?');
    expect(statement?.text).toContain('e.created_at_ms < ?');
    expect(statement?.text).toContain('LIMIT ?');
    // The one timestamp among the values (the other number is the batch).
    const cutoff = statement?.values.find(
      (value): value is number => typeof value === 'number' && value > DAY_MS,
    );
    expect(cutoff).toBeGreaterThanOrEqual(before - 37 * DAY_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 37 * DAY_MS);
    // The custodian is the owner of the chat that raised the event, and the
    // filter is part of the candidate query, so held rows never fill it.
    expect(statement?.text).toContain(
      'NOT EXISTS ( SELECT 1 FROM app.thread_metadata tm WHERE tm.thread_id = e.thread_id',
    );
    expect(statement?.text).toContain('tm.user_id = ANY(?)');
    expect(statement?.values).toContainEqual(['held-1']);
    const events = appendOf('chat_filter_event.retention_deleted');
    expect(events.tx).not.toBeNull();
    expect(events.tx).toBe(statement?.tx);
    expect(events.row.metadata).toEqual({
      category: 'chatFilterEvents',
      deleted: 4,
    });
    expect(appendOf('retention.run_completed').row.metadata).toMatchObject({
      deleted: 4,
      categories: { chatFilterEvents: { deleted: 4 } },
    });
  });

  it('drains guardrail events batch after batch in one transaction, one row for the run', async () => {
    givenPolicy({
      chatFilterEventsEnabled: true,
      chatFilterEventsRetentionDays: 30,
    });
    // Two full batches, then a short one: the whole backlog goes this run.
    const batches = [ids(1_000, 'a-'), ids(1_000, 'b-'), ids(7, 'c-')];
    const fake = fakeSql(
      orgRun({
        'DELETE FROM app.chat_filter_events': () => batches.shift() ?? [],
      }),
    );

    const results = await runRetentionCleanup(fake.sql);

    const deletes = fake.statements.filter((s) =>
      s.text.startsWith('DELETE FROM app.chat_filter_events'),
    );
    expect(deletes).toHaveLength(3);
    expect(new Set(deletes.map((s) => s.tx))).toEqual(
      new Set([deletes[0]?.tx]),
    );
    expect(results.org_1?.chatFilterEvents).toBe(2_007);
    const events = appendOf('chat_filter_event.retention_deleted');
    expect(events.tx).not.toBeNull();
    expect(events.tx).toBe(deletes[0]?.tx);
    expect(events.row.metadata).toEqual({
      category: 'chatFilterEvents',
      deleted: 2_007,
    });
    expect(appendOf('retention.run_completed').row.status).toBe('success');
  });

  it('stops a guardrail-event backlog at the run’s ceiling and leaves the rest for the next run', async () => {
    givenPolicy({
      chatFilterEventsEnabled: true,
      chatFilterEventsRetentionDays: 30,
    });
    // Every batch comes back full: a backlog larger than one run may take.
    const fake = fakeSql(
      orgRun({
        'DELETE FROM app.chat_filter_events': () => ids(1_000, 'event-'),
      }),
    );
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const results = await runRetentionCleanup(fake.sql);

    const deletes = fake.statements.filter((s) =>
      s.text.startsWith('DELETE FROM app.chat_filter_events'),
    );
    expect(deletes).toHaveLength(CHAT_FILTER_EVENT_MAX_BATCHES);
    const ceiling = CHAT_FILTER_EVENT_MAX_BATCHES * 1_000;
    expect(results.org_1?.chatFilterEvents).toBe(ceiling);
    expect(
      appendOf('chat_filter_event.retention_deleted').row.metadata,
    ).toEqual({ category: 'chatFilterEvents', deleted: ceiling });
    // A spent ceiling is no failure: the next night carries on.
    expect(appendOf('retention.run_completed').row.status).toBe('success');
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('the next run carries on'),
    );
    info.mockRestore();
  });

  it('leaves guardrail events alone while their category is off or has no window [RETAIN-R3]', async () => {
    for (const policy of [
      { chatFilterEventsEnabled: false, chatFilterEventsRetentionDays: 30 },
      { chatFilterEventsEnabled: true, chatFilterEventsRetentionDays: 0 },
      { chatFilterEventsEnabled: true },
    ]) {
      givenPolicy(policy);
      const fake = fakeSql(orgRun());

      await runRetentionCleanup(fake.sql);

      expect(
        fake.statements.some((s) => s.text.includes('app.chat_filter_events')),
      ).toBe(false);
    }
  });

  it('writes no destruction row for a category that destroyed nothing [RETAIN-R6]', async () => {
    givenPolicy({
      messageFeedbackEnabled: true,
      messageFeedbackRetentionDays: 30,
      contactsEnabled: true,
      contactsRetentionDays: 30,
    });
    const fake = fakeSql(orgRun());

    await runRetentionCleanup(fake.sql);

    expect(actions()).toEqual([
      'retention.run_started',
      'retention.run_completed',
    ]);
    const closing = appendOf('retention.run_completed').row.metadata;
    expect(closing?.deleted).toBe(0);
    expect(closing?.categories).toEqual({});
  });

  it('opens with the policy the run enforces and the holds in force [RETAIN-R6]', async () => {
    givenPolicy({ usageLedgerEnabled: true, usageLedgerRetentionDays: 60 });
    vi.mocked(loadActiveHolds).mockResolvedValue({
      orgHeld: false,
      userMembershipIds: new Set(['held-1', 'held-2']),
    });
    const fake = fakeSql(
      orgRun({
        'DELETE FROM app.usage_ledger': ids(2, 'ledger-'),
        'DELETE FROM app.usage_events': ids(1, 'event-'),
        'DELETE FROM app.project_usage': ids(1, 'project-'),
      }),
    );

    await runRetentionCleanup(fake.sql);

    const started = appendOf('retention.run_started');
    expect(started.row.metadata).toEqual({
      policy: {
        documentsRetentionDays: 30,
        usageLedgerEnabled: true,
        usageLedgerRetentionDays: 60,
      },
      holds: { organization: false, custodians: 2 },
    });
    // The retired usage events and the projects' own buckets age out on the
    // ledger's clock and are counted with it, in the ledger delete's
    // transaction.
    const ledger = appendOf('usage_ledger.retention_deleted');
    expect(ledger.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.usage_ledger'),
    );
    expect(ledger.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.usage_events'),
    );
    expect(ledger.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.project_usage'),
    );
    expect(ledger.row.metadata).toEqual({
      category: 'usageLedger',
      deleted: 4,
      counts: { usageLedger: 2, usageEvents: 1, projectUsage: 1 },
    });
  });

  it('writes a purge lane’s one row after its per-record transactions, counting expiry apart', async () => {
    givenPolicy({
      documentsEnabled: true,
      documentsRetentionDays: 30,
      deletionGraceDays: 7,
    });
    const fake = fakeSql(
      orgRun({
        "UPDATE app.documents SET lifecycle_status = 'expired'": ids(
          2,
          'doc-x',
        ),
        'SELECT id, file_ref': [
          {
            id: 'doc-a',
            fileRef: 's3:acme/a',
            historyFiles: [],
            projectId: null,
          },
          {
            id: 'doc-b',
            fileRef: 's3:acme/b',
            historyFiles: [],
            projectId: null,
          },
        ],
      }),
    );

    const results = await runRetentionCleanup(fake.sql);

    expect(results.org_1?.documents).toBe(4); // 2 expired + 2 purged
    const purges = fake.statements.filter(
      (s) => s.text === 'DELETE FROM app.documents WHERE id = ?',
    );
    expect(purges).toHaveLength(2);
    const documents = appendOf('document.retention_deleted');
    // Not inside any record's purge — in the batch's closing transaction,
    // the one that emits the change hints.
    expect(purges.map((purge) => purge.tx)).not.toContain(documents.tx);
    expect(
      fake.statements.some(
        (s) =>
          s.tx === documents.tx &&
          s.text.startsWith('INSERT INTO app_realtime.outbox'),
      ),
    ).toBe(true);
    expect(documents.row.metadata).toEqual({
      category: 'documents',
      deleted: 2,
    });
    // The expiry flip moved rows into the Trash; that is not destruction and
    // earns no row of its own, but the run's closing row counts it.
    expect(appendOf('retention.run_completed').row.metadata).toMatchObject({
      deleted: 2,
      categories: { documents: { deleted: 2, expired: 2 } },
    });
  });

  it('fails the run when a due record’s purge failed, counting it apart from what was destroyed [RETAIN-R7]', async () => {
    givenPolicy({ documentsEnabled: true, documentsRetentionDays: 30 });
    vi.mocked(releaseRefs).mockResolvedValueOnce({
      released: [],
      kept: [],
      failures: [{ ref: 's3:acme/a', stage: 'blob', message: 'store down' }],
    });
    const fake = fakeSql(
      orgRun({
        'SELECT id, file_ref': [
          {
            id: 'doc-a',
            fileRef: 's3:acme/a',
            historyFiles: [],
            projectId: null,
          },
          {
            id: 'doc-b',
            fileRef: 's3:acme/b',
            historyFiles: [],
            projectId: null,
          },
        ],
      }),
    );

    await runRetentionCleanup(fake.sql);

    expect(appendOf('document.retention_deleted').row.metadata).toEqual({
      category: 'documents',
      deleted: 1,
      failed: 1,
    });
    const failed = appendOf('retention.run_failed');
    expect(failed.row.status).toBe('failure');
    expect(failed.row.errorMessage).toBe(
      'documents: 1 kept after a failed purge',
    );
    expect(failed.row.metadata).toMatchObject({
      deleted: 1,
      categories: { documents: { deleted: 1, failed: 1 } },
    });
    expect(failed.row.metadata).not.toHaveProperty('failedCategory');
    expect(actions()).not.toContain('retention.run_completed');
  });

  it('fails the run on a throw, charged to the category in flight, and moves on to the next org [RETAIN-R7]', async () => {
    givenPolicy({
      messageFeedbackEnabled: true,
      messageFeedbackRetentionDays: 30,
      notificationsEnabled: true,
      notificationsRetentionDays: 30,
    });
    const fake = fakeSql(
      orgRun({
        'SELECT org_id AS id FROM app.retention_applied_bounds': [
          { id: 'org_1' },
          { id: 'org_2' },
        ],
        'DELETE FROM app.message_feedback': ids(2, 'feedback-'),
        'DELETE FROM app.notifications': (values) => {
          if (values.includes('org_1')) {
            throw new Error('notifications table unavailable');
          }
          return [];
        },
      }),
    );

    const results = await runRetentionCleanup(fake.sql);

    expect(Object.keys(results)).toEqual(['org_2']);
    const org1 = appended()
      .filter((call) => call.row.organizationId === 'org_1')
      .map((call) => call.row);
    expect(org1.map((row) => row.action)).toEqual([
      'retention.run_started',
      'message_feedback.retention_deleted',
      'retention.run_failed',
    ]);
    const failed = org1[2];
    expect(failed?.status).toBe('failure');
    expect(failed?.errorMessage).toBe('notifications table unavailable');
    // What the categories before it destroyed is still on the failure row.
    expect(failed?.metadata).toMatchObject({
      failedCategory: 'notifications',
      deleted: 2,
      categories: { messageFeedback: { deleted: 2 } },
    });
    const org2 = appended()
      .filter((call) => call.row.organizationId === 'org_2')
      .map((call) => call.row.action);
    expect(org2).toEqual([
      'retention.run_started',
      'message_feedback.retention_deleted',
      'retention.run_completed',
    ]);
  });

  it('books nothing for a category whose row could not be appended — its deletes rolled back with it', async () => {
    givenPolicy({
      messageFeedbackEnabled: true,
      messageFeedbackRetentionDays: 30,
    });
    vi.mocked(createAuditLog).mockImplementation((_tx, row) =>
      row.action === 'message_feedback.retention_deleted'
        ? Promise.reject(new Error('audit chain refused the row'))
        : Promise.resolve('audit-row'),
    );
    const fake = fakeSql(
      orgRun({ 'DELETE FROM app.message_feedback': ids(2, 'feedback-') }),
    );

    await runRetentionCleanup(fake.sql);

    const failed = appendOf('retention.run_failed');
    expect(failed.row.errorMessage).toBe('audit chain refused the row');
    expect(failed.row.metadata).toMatchObject({
      failedCategory: 'messageFeedback',
      deleted: 0,
    });
    expect(failed.row.metadata?.categories).toEqual({});
  });

  it('records a held org’s run as started and completed, destroying nothing [RETAIN-R2]', async () => {
    givenPolicy({
      messageFeedbackEnabled: true,
      messageFeedbackRetentionDays: 30,
      chatFilterEventsEnabled: true,
      chatFilterEventsRetentionDays: 30,
      documentsEnabled: true,
    });
    vi.mocked(loadActiveHolds).mockResolvedValue({
      orgHeld: true,
      userMembershipIds: new Set(),
    });
    const fake = fakeSql(orgRun());

    await runRetentionCleanup(fake.sql);

    expect(actions()).toEqual([
      'retention.run_started',
      'retention.run_completed',
    ]);
    expect(appendOf('retention.run_started').row.metadata).toMatchObject({
      holds: { organization: true, custodians: 0 },
    });
    expect(fake.statements.some((s) => s.text.startsWith('DELETE'))).toBe(
      false,
    );
  });

  it('writes nothing for an org without a valid policy [RETAIN-R4]', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
    const fake = fakeSql(orgRun());

    expect(await runRetentionCleanup(fake.sql)).toEqual({});
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('sweepOrgPhase2 — destruction rows', () => {
  it('records the audit prefix’s cut in the transaction that removed it', async () => {
    const fake = fakeSql({
      'SELECT id, actor_id': [
        {
          id: 'a1',
          actorId: 'x',
          resourceType: 'doc',
          resourceId: null,
          ts: 1,
          integrityHash: 'h1',
        },
        {
          id: 'a2',
          actorId: 'x',
          resourceType: 'doc',
          resourceId: null,
          ts: 2,
          integrityHash: 'h2',
        },
        {
          id: 'a3',
          actorId: 'held',
          resourceType: 'doc',
          resourceId: null,
          ts: 3,
          integrityHash: 'h3',
        },
      ],
      'DELETE FROM app.audit_logs': ids(2, 'a'),
    });
    const before = Date.now();

    await sweepOrgPhase2(
      fake.sql,
      {
        organizationId: 'org_1',
        config: { auditLogEnabled: true, auditLogRetentionDays: 365 },
      },
      { orgHeld: false, userMembershipIds: new Set(['held']) },
    );

    const audit = appendOf('audit_log.retention_deleted');
    expect(audit.tx).toBe(txOf(fake.statements, 'SELECT id, actor_id'));
    expect(audit.tx).toBe(txOf(fake.statements, 'DELETE FROM app.audit_logs'));
    // The walk stopped at the held actor: the surviving chain now anchors on
    // the hash of the newest row removed.
    expect(audit.row.metadata).toMatchObject({
      category: 'auditLogs',
      deleted: 2,
      lastDeletedHash: 'h2',
    });
    const olderThan = audit.row.metadata?.olderThan;
    expect(olderThan).toBeGreaterThanOrEqual(before - 365 * DAY_MS);
    expect(olderThan).toBeLessThanOrEqual(Date.now() - 365 * DAY_MS);
  });

  it('writes one temp-file row for both sources, after both batches', async () => {
    const fake = fakeSql({
      'SELECT id, storage_ref AS "storageRef" FROM app.file_metadata': (
        values,
      ) =>
        values.includes('user')
          ? [
              { id: 'u1', storageRef: 's3:acme/u1' },
              { id: 'u2', storageRef: 's3:acme/u2' },
            ]
          : [{ id: 'g1', storageRef: 's3:acme/g1' }],
    });

    const stats = await sweepOrgPhase2(
      fake.sql,
      {
        organizationId: 'org_1',
        config: {
          userTempEnabled: true,
          userTempRetentionHours: 24,
          agentTempEnabled: true,
          agentTempRetentionHours: 24,
        },
      },
      { orgHeld: false, userMembershipIds: new Set() },
    );

    expect(stats.tempFiles).toBe(3);
    const temp = appendOf('file_metadata.retention_deleted');
    const fileDeletes = fake.statements.filter((s) =>
      s.text.startsWith('DELETE FROM app.file_metadata WHERE id = ?'),
    );
    expect(fileDeletes).toHaveLength(3);
    expect(fileDeletes.map((s) => s.tx)).not.toContain(temp.tx);
    expect(temp.row.metadata).toEqual({
      category: 'tempFiles',
      deleted: 3,
      counts: { userTemp: 2, agentTemp: 1 },
    });
  });

  it('writes the conversations’ row with the conversation delete, attachments counted', async () => {
    const fake = fakeSql({
      'SELECT id FROM app.conversations': ids(2, 'conv-'),
      'SELECT id, storage_ref AS "storageRef", conversation_id': [
        { id: 'att-1', storageRef: 's3:acme/att-1', conversationId: 'conv-0' },
      ],
      'DELETE FROM app.conversations': ids(2, 'conv-'),
    });

    await sweepOrgPhase2(
      fake.sql,
      {
        organizationId: 'org_1',
        config: {
          externalConversationsEnabled: true,
          externalConversationsRetentionDays: 30,
        },
      },
      { orgHeld: false, userMembershipIds: new Set() },
    );

    const conversations = appendOf('external_conversation.retention_deleted');
    expect(conversations.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.conversations'),
    );
    expect(conversations.row.metadata).toEqual({
      category: 'externalConversations',
      deleted: 3,
      counts: { conversations: 2, attachments: 1 },
    });
  });

  it('writes one row each for agent runs, automation runs and the sandbox ledgers, in their delete’s transaction', async () => {
    const fake = fakeSql({
      'DELETE FROM app.project_agent_runs': ids(2, 'agent-run-'),
      'SELECT id FROM app.automation_runs': ids(4, 'run-'),
      'DELETE FROM app.automation_runs': ids(4, 'run-'),
      'DELETE FROM app.sandbox_tool_calls': ids(3, 'call-'),
      'DELETE FROM app.sandbox_credential_access': ids(1, 'grant-'),
    });

    await sweepOrgPhase2(
      fake.sql,
      {
        organizationId: 'org_1',
        config: {
          agentRunsEnabled: true,
          agentRunsRetentionDays: 30,
          workflowLogEnabled: true,
          workflowLogRetentionDays: 30,
          auditLogEnabled: true,
          auditLogRetentionDays: 365,
        },
      },
      { orgHeld: false, userMembershipIds: new Set() },
    );

    const agentRuns = appendOf('agent_run.retention_deleted');
    expect(agentRuns.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.project_agent_runs'),
    );
    expect(agentRuns.row.metadata).toEqual({
      category: 'agentRuns',
      deleted: 2,
    });
    const automationRuns = appendOf('automation_run.retention_deleted');
    expect(automationRuns.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.automation_runs'),
    );
    expect(automationRuns.row.metadata).toEqual({
      category: 'automationRuns',
      deleted: 4,
    });
    const ledgers = appendOf('sandbox_ledger.retention_deleted');
    expect(ledgers.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.sandbox_tool_calls'),
    );
    expect(ledgers.tx).toBe(
      txOf(fake.statements, 'DELETE FROM app.sandbox_credential_access'),
    );
    expect(ledgers.row.metadata).toEqual({
      category: 'sandboxLedgers',
      deleted: 4,
      counts: { toolCalls: 3, credentialAccess: 1 },
    });
  });

  // The delete clears a purged run from the trigger that names it (`ON
  // DELETE SET NULL`), so when a trigger names a run of the batch the
  // organization's audit chain goes between the runs' own rows and that
  // delete — the order a landing run takes them in
  // (`automations/trigger-failures.ts`).
  it('locks the automation runs it removes, then deletes them, in one transaction, with no organization-wide lock', async () => {
    const fake = fakeSql({
      'SELECT id FROM app.automation_runs': ids(2, 'run-'),
      'DELETE FROM app.automation_runs': ids(2, 'run-'),
    });

    await sweepOrgPhase2(
      fake.sql,
      {
        organizationId: 'org_1',
        config: { workflowLogEnabled: true, workflowLogRetentionDays: 30 },
      },
      { orgHeld: false, userMembershipIds: new Set() },
    );

    const tx = txOf(fake.statements, 'DELETE FROM app.automation_runs');
    const inTx = fake.statements.filter((s) => s.tx === tx);
    const at = (predicate: (text: string) => boolean) =>
      inTx.findIndex((s) => predicate(s.text));
    const batch = at((text) =>
      text.startsWith('SELECT id FROM app.automation_runs'),
    );
    const removal = at((text) =>
      text.startsWith('DELETE FROM app.automation_runs'),
    );
    expect(inTx[batch]?.text).toContain('FOR UPDATE');
    expect(batch).toBeGreaterThan(-1);
    // The run rows, then the delete that clears a trigger naming one of them
    // (`ON DELETE SET NULL`) — the order a landing run takes them in — and
    // nothing in between: no probe of the triggers, no advisory lock.
    expect(removal).toBe(batch + 1);
    expect(inTx.some((s) => s.text.includes('pg_advisory_xact_lock'))).toBe(
      false,
    );
    expect(inTx[removal]?.values).toEqual([['run-0', 'run-1']]);
    expect(appendOf('automation_run.retention_deleted').tx).toBe(tx);
  });

  it('takes no lock and deletes nothing when no automation run is due', async () => {
    const fake = fakeSql({});

    await sweepOrgPhase2(
      fake.sql,
      {
        organizationId: 'org_1',
        config: { workflowLogEnabled: true, workflowLogRetentionDays: 30 },
      },
      { orgHeld: false, userMembershipIds: new Set() },
    );

    expect(
      fake.statements.some((s) => s.text.includes('pg_advisory_xact_lock')),
    ).toBe(false);
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('DELETE FROM app.automation_runs'),
      ),
    ).toBe(false);
    expect(actions()).toEqual([]);
  });
});
