import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyAutomationMessage } from '../collab/service.ts';
import { pgNotifyStore } from './notify-store.ts';

vi.mock('../collab/service.ts', () => ({
  notifyAutomationMessage: vi.fn(),
}));

/** Who started the run, as `started_by` stores it; null when it is gone. */
let startedBy: string | null;
/** The automation's newest declared presentation, and the organization's. */
let presentation: unknown;
let organizationMetadata: unknown;
/** The organization's addressable members: id → email. */
const MEMBERS: Record<string, string> = {
  usr_ada: 'ada@example.com',
  usr_noah: 'noah@example.com',
  usr_mia: 'mia@example.com',
};
const statements: { text: string; values: unknown[] }[] = [];
const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
  statements.push({ text, values });
  if (text.includes('FROM app.automation_runs')) {
    return Promise.resolve(
      startedBy === null
        ? []
        : [
            {
              name: 'reports/weekly',
              startedBy,
              presentation,
              organizationMetadata,
            },
          ],
    );
  }
  if (text.includes('FROM "member" m JOIN "user" u')) {
    // The lookup's values: the organization, then the ids, then the emails.
    const [, ids, emails] = values as [string, string[], string[]];
    return Promise.resolve(
      Object.entries(MEMBERS)
        .filter(([id, email]) => ids.includes(id) || emails.includes(email))
        .map(([id, email]) => ({ id, email })),
    );
  }
  return Promise.resolve([]);
});
const sql = {
  begin: async (callback: (transaction: unknown) => unknown) => callback(tx),
} as unknown as Sql;

const ask = {
  organizationId: 'org_1',
  runId: 'run_7',
  idempotencyKey: 'run_7/tell/0/0',
  title: 'Weekly report ready',
  message: 'Revenue is up 4 %.',
  link: '/dashboard/org_1/documents',
};

beforeEach(() => {
  vi.mocked(notifyAutomationMessage).mockReset();
  vi.mocked(notifyAutomationMessage).mockImplementation(async (_tx, args) => ({
    ok: true,
    delivered: args.userIds.filter((id) => id !== 'usr_noah'),
    muted: args.userIds.filter((id) => id === 'usr_noah'),
  }));
  startedBy = 'user:usr_mia';
  presentation = {
    name: 'Weekly report',
    i18n: { de: { name: 'Wochenbericht' } },
  };
  organizationMetadata = JSON.stringify({ defaultLocale: 'de' });
  statements.length = 0;
});

describe('a message an automation step sends [CONN-R25]', () => {
  it('reaches each member it names once, as the run, and lists who switched it off', async () => {
    const answer = await pgNotifyStore(sql).notify({
      ...ask,
      to: ['ADA@example.com', 'usr_noah', 'usr_ada', 'run-starter'],
    });
    expect(answer).toEqual({
      ok: true,
      delivered: [
        // Under the first name the step gave them.
        { to: 'ADA@example.com', userId: 'usr_ada' },
        { to: 'run-starter', userId: 'usr_mia' },
      ],
      skipped: [{ to: 'usr_noah', userId: 'usr_noah', reason: 'preference' }],
    });
    expect(notifyAutomationMessage).toHaveBeenCalledWith(tx, {
      organizationId: 'org_1',
      runId: 'run_7',
      deliveryKey: 'run_7/tell/0/0',
      userIds: ['usr_ada', 'usr_noah', 'usr_mia'],
      // Its declared name, in the organization's language.
      automation: 'Wochenbericht',
      title: 'Weekly report ready',
      message: 'Revenue is up 4 %.',
      link: '/dashboard/org_1/documents',
      runCap: 100,
    });
    // A disabled membership and an API key's own identity are nobody to tell.
    const lookup = statements.find((s) => s.text.includes('FROM "member"'));
    expect(lookup?.text).toContain(`lower(m."role") <> 'disabled'`);
    expect(lookup?.text).toContain(`NOT LIKE '%.invalid'`);
  });

  it('refuses the whole message, sending nothing, when someone it names is not a member', async () => {
    await expect(
      pgNotifyStore(sql).notify({
        ...ask,
        to: ['ada@example.com', 'eve@example.com', 'usr_gone'],
      }),
    ).resolves.toEqual({
      ok: false,
      refusal: {
        kind: 'not_a_member',
        recipients: ['eve@example.com', 'usr_gone'],
      },
    });
    expect(notifyAutomationMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['a trigger started the run', 'trigger:trg_1'],
    ['its starter left the organization', 'user:usr_left'],
  ])('lists run-starter as skipped when %s', async (_case, starter) => {
    startedBy = starter;
    const answer = await pgNotifyStore(sql).notify({
      ...ask,
      to: ['run-starter', 'ada@example.com'],
    });
    expect(answer).toEqual({
      ok: true,
      delivered: [{ to: 'ada@example.com', userId: 'usr_ada' }],
      skipped: [{ to: 'run-starter', reason: 'no_starter' }],
    });
  });

  it('names an automation that declares no name by its slug, read as a title', async () => {
    presentation = null;
    organizationMetadata = null;
    await pgNotifyStore(sql).notify({ ...ask, to: ['ada@example.com'] });
    expect(
      vi.mocked(notifyAutomationMessage).mock.calls[0]?.[1].automation,
    ).toBe('Weekly');
  });

  it('asks nobody when the run names no one but a starter it does not have', async () => {
    startedBy = 'trigger:trg_1';
    await pgNotifyStore(sql).notify({ ...ask, to: ['run-starter'] });
    expect(statements.some((s) => s.text.includes('FROM "member"'))).toBe(
      false,
    );
  });
});

describe('the run behind a message [CONN-R26]', () => {
  it('refuses a step that would take the run past its cap', async () => {
    vi.mocked(notifyAutomationMessage).mockResolvedValue({
      ok: false,
      sent: 99,
    });
    await expect(
      pgNotifyStore(sql).notify({ ...ask, to: ['ada@example.com', 'usr_mia'] }),
    ).resolves.toEqual({
      ok: false,
      refusal: { kind: 'run_limit', limit: 100, sent: 99 },
    });
  });

  it('answers a run that is gone', async () => {
    startedBy = null;
    await expect(
      pgNotifyStore(sql).notify({ ...ask, to: ['ada@example.com'] }),
    ).resolves.toEqual({ ok: false, refusal: { kind: 'no_run' } });
    expect(notifyAutomationMessage).not.toHaveBeenCalled();
  });
});
