import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listApprovalAllowances,
  readApprovalAllowanceRows,
  setApprovalAllowances,
  writeActionOf,
} from './approval-allowances.ts';
import { auditDefinitionWrite } from './audit.ts';

vi.mock('./audit.ts', () => ({ auditDefinitionWrite: vi.fn() }));
const governance = vi.hoisted(() => ({ policy: null as unknown }));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  readGovernancePolicyForOrg: () => Promise.resolve(governance.policy),
}));

/** The allowances on file, as `connector.action`, and whether the
 * automation exists. */
let onFile: string[];
let exists: boolean;
/** The latest version's document. */
let latestDocument: unknown;
const statements: { text: string; values: unknown[] }[] = [];
const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
  statements.push({ text, values });
  if (text.startsWith('SELECT name, version, document')) {
    return Promise.resolve(
      latestDocument === undefined
        ? []
        : [{ name: 'morning-digest', version: 3, document: latestDocument }],
    );
  }
  if (text.includes('FROM app.automations')) {
    return Promise.resolve(exists ? [{ found: 1 }] : []);
  }
  if (text.startsWith('SELECT id, name, email FROM "user"')) {
    return Promise.resolve([
      { id: 'user-ada', name: 'Ada Lovelace', email: 'ada@example.com' },
    ]);
  }
  if (text.startsWith('SELECT connector, action')) {
    return Promise.resolve(
      onFile.map((type) => {
        const [connector, action] = type.split('.');
        return {
          connector,
          action,
          grantedBy: 'user-ada',
          grantedAt: 1_791_000_000_000,
          note: null,
        };
      }),
    );
  }
  return Promise.resolve([]);
});
const sql = {
  begin: async (work: (transaction: unknown) => unknown) => work(tx),
} as unknown as Sql;

const ask = {
  organizationId: 'org-1',
  automation: 'morning-digest',
  actor: 'user:user-ada',
  grantedBy: 'user-ada',
};

beforeEach(() => {
  onFile = [];
  exists = true;
  latestDocument = undefined;
  governance.policy = null;
  statements.length = 0;
  vi.mocked(auditDefinitionWrite).mockReset();
});

describe('the writes an automation may make without approval [APV-R13]', () => {
  it.each([
    ['slack.send_message', { connector: 'slack', action: 'send_message' }],
    ['http.send', { connector: 'http', action: 'send' }],
    // A read changes nothing and is never gated.
    ['http.get', null],
    // A write on the platform's own surface never waits by default.
    ['task.create', null],
    ['conversation.record_triage', null],
    ['slack.nonexistent', null],
    ['nothing', null],
  ])('reads %s as a write action of the catalog: %o', (type, expected) => {
    expect(writeActionOf(type)).toEqual(expected);
  });

  it('grants what is new and withdraws what is gone, one audit row each, under the name lock', async () => {
    onFile = ['slack.send_message', 'http.send'];
    await expect(
      setApprovalAllowances(sql, {
        ...ask,
        allowed: ['slack.send_message', 'github.create_issue'],
      }),
    ).resolves.toEqual({
      granted: ['github.create_issue'],
      withdrawn: ['http.send'],
    });
    expect(statements[0]?.text).toContain('pg_advisory_xact_lock');
    const insert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.automation_approval_allowances'),
    );
    expect(insert?.values).toEqual([
      'org-1',
      'morning-digest',
      'github',
      'create_issue',
      'user-ada',
      expect.any(Number),
    ]);
    const removal = statements.find((s) =>
      s.text.startsWith('DELETE FROM app.automation_approval_allowances'),
    );
    expect(removal?.values).toEqual([
      'org-1',
      'morning-digest',
      'http',
      'send',
    ]);
    expect(
      vi
        .mocked(auditDefinitionWrite)
        .mock.calls.map((call) => [
          call[1].action,
          call[1].newState ?? call[1].previousState,
        ]),
    ).toEqual([
      [
        'automation.approval_allowance.granted',
        { type: 'github.create_issue' },
      ],
      ['automation.approval_allowance.revoked', { type: 'http.send' }],
    ]);
  });

  it('writes nothing when the set is already as asked', async () => {
    onFile = ['slack.send_message'];
    await expect(
      setApprovalAllowances(sql, { ...ask, allowed: ['slack.send_message'] }),
    ).resolves.toEqual({ granted: [], withdrawn: [] });
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
  });

  it('refuses anything but a write action of the catalog, writing nothing', async () => {
    await expect(
      setApprovalAllowances(sql, {
        ...ask,
        allowed: ['slack.send_message', 'http.get', 'made.up'],
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_ALLOWANCE_INVALID',
      data: { types: ['http.get', 'made.up'] },
    });
    expect(statements).toEqual([]);
  });

  it('refuses an automation that no longer exists', async () => {
    exists = false;
    await expect(
      setApprovalAllowances(sql, { ...ask, allowed: ['slack.send_message'] }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_NOT_FOUND', status: 404 });
    expect(statements.some((s) => s.text.startsWith('INSERT INTO'))).toBe(
      false,
    );
  });

  it('lists the allowances by their step type', async () => {
    onFile = ['slack.send_message'];
    await expect(
      listApprovalAllowances(tx as unknown as Sql, {
        organizationId: 'org-1',
        automation: 'morning-digest',
      }),
    ).resolves.toEqual([
      {
        type: 'slack.send_message',
        grantedBy: 'user-ada',
        grantedAt: 1_791_000_000_000,
        note: null,
      },
    ]);
  });
});

describe('the write actions an automation lists in its General tab', () => {
  it('lists what its latest version writes, and what it was allowed and no longer uses', async () => {
    latestDocument = {
      version: 1,
      name: 'morning-digest',
      nodes: [
        { id: 'fetch', type: 'http.get' },
        { id: 'post', type: 'slack.send_message' },
        { id: 'again', type: 'slack.send_message' },
        { id: 'file', type: 'github.create_issue' },
      ],
    };
    onFile = ['http.send', 'slack.send_message'];
    await expect(
      readApprovalAllowanceRows(tx as unknown as Sql, {
        organizationId: 'org-1',
        automation: 'morning-digest',
      }),
    ).resolves.toEqual([
      {
        type: 'github.create_issue',
        used: true,
        policy: null,
        allowance: null,
      },
      {
        type: 'http.send',
        used: false,
        policy: null,
        allowance: {
          grantedBy: 'user-ada',
          grantedByName: 'Ada Lovelace',
          grantedAt: 1_791_000_000_000,
        },
      },
      {
        type: 'slack.send_message',
        used: true,
        policy: null,
        allowance: {
          grantedBy: 'user-ada',
          grantedByName: 'Ada Lovelace',
          grantedAt: 1_791_000_000_000,
        },
      },
    ]);
  });

  it('lists nothing for an automation that writes nothing and was allowed nothing', async () => {
    latestDocument = {
      version: 1,
      name: 'x',
      nodes: [{ id: 'a', type: 'http.get' }],
    };
    await expect(
      readApprovalAllowanceRows(tx as unknown as Sql, {
        organizationId: 'org-1',
        automation: 'x',
      }),
    ).resolves.toEqual([]);
  });
});

describe("a write the organization's approval policy decides", () => {
  it('says when a rule requires a person, or already lets it run', async () => {
    latestDocument = {
      version: 1,
      name: 'digest',
      nodes: [
        { id: 'post', type: 'slack.send_message' },
        { id: 'file', type: 'github.create_issue' },
        { id: 'call', type: 'http.send' },
      ],
    };
    governance.policy = {
      rules: [
        { action: 'slack.send_message', decision: 'require_approval' },
        { connector: 'github', decision: 'auto_approve' },
      ],
    };
    const rows = await readApprovalAllowanceRows(tx as unknown as Sql, {
      organizationId: 'org-1',
      automation: 'digest',
    });
    expect(rows.map((row) => [row.type, row.policy])).toEqual([
      ['github.create_issue', 'allows'],
      ['http.send', null],
      ['slack.send_message', 'requires'],
    ]);
  });
});
