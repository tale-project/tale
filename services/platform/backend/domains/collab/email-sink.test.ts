import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIONABLE_EMAIL_CONNECTORS } from '../../core/notifications/actionable_email_connectors.ts';
import { runConnectorAction } from '../connectors/service.ts';
import { runNotificationEmailJob } from './email-sink.ts';

vi.mock('../connectors/service.ts', () => ({ runConnectorAction: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

type Row = Record<string, unknown>;

const MAILBOX = [...ACTIONABLE_EMAIL_CONNECTORS][0];

/**
 * The sink's reads, answered from each statement's (whitespace-collapsed)
 * text: the row, the reader check, the address, the preference, the
 * organization's mailboxes and its locale.
 */
function fakeSql(world: {
  taskId: string | null;
  readers: string[];
  /** The row's own fields, over a task assignment's. */
  row?: Row;
}): {
  sql: Sql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray | readonly string[],
    ...values: unknown[]
  ): unknown => {
    // `sql(list)` — an IN list — hands the list back as the value.
    if (!('raw' in strings)) return strings;
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    let rows: Row[] = [];
    if (text.startsWith('SELECT user_id AS "userId"')) {
      rows = [
        {
          userId: 'u-1',
          organizationId: 'org-1',
          type: 'task_assigned',
          titleKey: 'taskAssigned',
          bodyKey: 'taskAssignedBody',
          params: { title: 'Acquisition of Contoso', projectId: 'proj-1' },
          taskId: world.taskId,
          read: false,
          emailEpoch: 2,
          ...world.row,
        },
      ];
    } else if (text.startsWith('WITH audience AS')) {
      const asked = values.find((v): v is string[] => Array.isArray(v)) ?? [];
      rows = asked
        .filter((id) => world.readers.includes(id))
        .map((userId) => ({ userId }));
    } else if (text.startsWith('SELECT "email" FROM "user"')) {
      rows = [{ email: 'u-1@example.com' }];
    } else if (text.includes('FROM app.connector_credentials')) {
      rows = [
        { credentialId: 'cred-1', connectorSlug: MAILBOX, isDefault: true },
      ];
    }
    return Promise.resolve(rows);
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (value: string) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js template function
  return { sql: sql as unknown as Sql, statements };
}

const PAYLOAD = { notificationId: 'n-1', epoch: 2 };

describe('the notification email sink [COLLAB-R2]', () => {
  beforeEach(() => {
    vi.mocked(runConnectorAction).mockReset();
    vi.mocked(runConnectorAction).mockResolvedValue({
      status: 'ok',
    } as Awaited<ReturnType<typeof runConnectorAction>>);
  });

  it("sends a task's email to someone who can still open the task", async () => {
    const { sql, statements } = fakeSql({ taskId: 'task-1', readers: ['u-1'] });

    await runNotificationEmailJob(sql, PAYLOAD);

    const check = statements.find((text) =>
      text.startsWith('WITH audience AS'),
    );
    expect(check).toContain('SELECT project_id FROM app.tasks');
    expect(runConnectorAction).toHaveBeenCalledTimes(1);
  });

  it('sends nothing about a task to someone who lost access since the row was written (#3631)', async () => {
    const { sql, statements } = fakeSql({ taskId: 'task-1', readers: [] });

    await runNotificationEmailJob(sql, PAYLOAD);

    expect(runConnectorAction).not.toHaveBeenCalled();
    // The check comes first: no address, preference or mailbox is read.
    expect(statements.some((text) => text.includes('FROM "user"'))).toBe(false);
    expect(
      statements.some((text) =>
        text.includes('FROM app.connector_credentials'),
      ),
    ).toBe(false);
  });

  it('checks no access for a row about no task', async () => {
    const { sql, statements } = fakeSql({ taskId: null, readers: [] });

    await runNotificationEmailJob(sql, PAYLOAD);

    expect(statements.some((text) => text.startsWith('WITH audience AS'))).toBe(
      false,
    );
    expect(runConnectorAction).toHaveBeenCalledTimes(1);
  });
});

describe("an automation message's email", () => {
  const message = (link: string): Row => ({
    type: 'automation_message',
    titleKey: 'automationMessage',
    bodyKey: 'automationMessageBody',
    params: {
      automation: 'reports/weekly',
      runId: 'run-1',
      title: 'Weekly report ready',
      message: 'Revenue is up.',
      link,
      deliveryKey: 'run-1/tell/0/0',
    },
  });
  const sentEmail = (): string =>
    JSON.stringify(vi.mocked(runConnectorAction).mock.calls[0]?.[1].input);

  beforeEach(() => {
    vi.mocked(runConnectorAction).mockReset();
    vi.mocked(runConnectorAction).mockResolvedValue({
      status: 'ok',
    } as Awaited<ReturnType<typeof runConnectorAction>>);
  });

  it('takes its button to a web link, named for what it opens', async () => {
    const { sql } = fakeSql({
      taskId: null,
      readers: [],
      row: message('https://reports.example.com/weekly'),
    });
    await runNotificationEmailJob(sql, PAYLOAD);
    const email = sentEmail();
    expect(email).toContain('Weekly report ready');
    expect(email).toContain(
      'Open the link: https://reports.example.com/weekly',
    );
    expect(email).not.toContain('Open in Tale');
  });

  it('opens a page of the organization in Tale', async () => {
    const { sql } = fakeSql({
      taskId: null,
      readers: [],
      row: message('/dashboard/org-1/documents'),
    });
    await runNotificationEmailJob(sql, PAYLOAD);
    expect(sentEmail()).toMatch(
      /Open in Tale: https?:[^"]*\/dashboard\/org-1\/documents/,
    );
  });
});
