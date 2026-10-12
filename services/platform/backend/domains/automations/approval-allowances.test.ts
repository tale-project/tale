import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appOrigin } from '../../lib/write-origin.ts';
import {
  approvalAllowanceHash,
  approvalPolicyOn,
  automationsWithAllowances,
  changeApprovalAllowances,
  listApprovalAllowances,
  readApprovalAllowanceRows,
  readApprovalAllowanceView,
  setApprovalAllowances,
  writeActionOf,
  writeTypesUsedBy,
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
  origin: appOrigin('user-ada'),
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

/** What a call wrote to the allowances table: its inserts and deletes. */
const allowanceWrites = () =>
  statements.filter((s) =>
    /^(INSERT INTO|DELETE FROM) app\.automation_approval_allowances/.test(
      s.text,
    ),
  );

/** How many times the call told the automation's open editors. */
const hints = () =>
  statements.filter((s) => s.text.startsWith('INSERT INTO app_realtime.outbox'))
    .length;

/** What an audit row of the call recorded, by action. */
const audited = () =>
  vi
    .mocked(auditDefinitionWrite)
    .mock.calls.map((call) => [
      call[1].action,
      call[1].newState ?? call[1].previousState,
    ]);

describe('the set an allowance change is read against [MCP-R39]', () => {
  it('names the set by its automation and its types, whatever their order or repeats', () => {
    expect(approvalAllowanceHash('digest', ['slack.send_message'])).toBe(
      approvalAllowanceHash('digest', [
        'slack.send_message',
        'slack.send_message',
      ]),
    );
    expect(approvalAllowanceHash('digest', ['http.send', 'slack.send'])).toBe(
      approvalAllowanceHash('digest', ['slack.send', 'http.send']),
    );
    expect(approvalAllowanceHash('digest', ['http.send'])).not.toBe(
      approvalAllowanceHash('other', ['http.send']),
    );
    expect(approvalAllowanceHash('digest', [])).not.toBe(
      approvalAllowanceHash('digest', ['http.send']),
    );
  });
});

describe('allowing and withdrawing writes against the set that was read [MCP-R39]', () => {
  const held = ['http.send', 'slack.send_message'];
  const hashOf = (types: readonly string[]) =>
    approvalAllowanceHash('morning-digest', types);

  it('allows a write on top of the ones allowed, one audit row, under the name lock', async () => {
    onFile = held;
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'grant',
        types: ['github.create_issue'],
        expectedHash: hashOf(held),
      }),
    ).resolves.toEqual({
      granted: ['github.create_issue'],
      withdrawn: [],
      hash: hashOf(['github.create_issue', ...held]),
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
    expect(allowanceWrites()).toHaveLength(1);
    expect(hints()).toBe(1);
    expect(audited()).toEqual([
      [
        'automation.approval_allowance.granted',
        { type: 'github.create_issue' },
      ],
    ]);
  });

  it('withdraws only the writes it names, one audit row each', async () => {
    onFile = held;
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'revoke',
        types: ['http.send'],
        expectedHash: hashOf(held),
      }),
    ).resolves.toEqual({
      granted: [],
      withdrawn: ['http.send'],
      hash: hashOf(['slack.send_message']),
    });
    const removal = statements.find((s) =>
      s.text.startsWith('DELETE FROM app.automation_approval_allowances'),
    );
    expect(removal?.values).toEqual([
      'org-1',
      'morning-digest',
      'http',
      'send',
    ]);
    expect(allowanceWrites()).toHaveLength(1);
    expect(audited()).toEqual([
      ['automation.approval_allowance.revoked', { type: 'http.send' }],
    ]);
  });

  it('refuses a set that moved since it was read, writing nothing', async () => {
    onFile = ['slack.send_message'];
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'grant',
        types: ['github.create_issue'],
        expectedHash: hashOf(held),
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT', status: 409 });
    expect(allowanceWrites()).toEqual([]);
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
  });

  it('writes nothing for a write already allowed or already withheld, and answers the hash it read', async () => {
    onFile = held;
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'grant',
        types: ['http.send'],
        expectedHash: hashOf(held),
      }),
    ).resolves.toEqual({ granted: [], withdrawn: [], hash: hashOf(held) });
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'revoke',
        types: ['github.create_issue'],
        expectedHash: hashOf(held),
      }),
    ).resolves.toEqual({ granted: [], withdrawn: [], hash: hashOf(held) });
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
    expect(allowanceWrites()).toEqual([]);
    expect(hints()).toBe(0);
  });

  it('refuses to allow anything but a write action of the catalog, before it opens a transaction', async () => {
    const begin = vi.spyOn(sql, 'begin');
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'grant',
        types: ['slack.send_message', 'http.get', 'made.up'],
        expectedHash: hashOf([]),
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_ALLOWANCE_INVALID',
      data: { types: ['http.get', 'made.up'] },
    });
    expect(begin).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
    begin.mockRestore();
  });

  it('withdraws an allowance whose action the catalog no longer has, and refuses a name that is neither', async () => {
    onFile = ['legacy.removed', 'slack.send_message'];
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'revoke',
        types: ['legacy.removed'],
        expectedHash: hashOf(onFile),
      }),
    ).resolves.toMatchObject({ granted: [], withdrawn: ['legacy.removed'] });
    statements.length = 0;
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'revoke',
        types: ['made.up', 'slack.send_message'],
        expectedHash: hashOf(onFile),
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_ALLOWANCE_INVALID',
      data: { types: ['made.up'] },
    });
    expect(allowanceWrites()).toEqual([]);
  });

  it('refuses an automation that no longer exists', async () => {
    exists = false;
    await expect(
      changeApprovalAllowances(sql, {
        ...ask,
        act: 'grant',
        types: ['slack.send_message'],
        expectedHash: hashOf([]),
      }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_NOT_FOUND', status: 404 });
    expect(allowanceWrites()).toEqual([]);
  });
});

describe('the automations that hold an allowance', () => {
  it('are listed by name, once each', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: one tagged query
    const db = (async () => [
      { name: 'ops/b' },
      { name: 'a/z' },
      { name: 'ops/a' },
    ]) as unknown as Sql;
    await expect(automationsWithAllowances(db, 'org-1')).resolves.toEqual([
      'a/z',
      'ops/a',
      'ops/b',
    ]);
  });
});

describe('the writes a document makes', () => {
  it('lists the steps that write to an outside system, once each, and nothing else', () => {
    expect(
      writeTypesUsedBy({
        version: 1,
        nodes: [
          { id: 'a', type: 'http.get' },
          { id: 'b', type: 'slack.send_message' },
          { id: 'c', type: 'slack.send_message' },
          { id: 'd', type: 'task.create' },
          { id: 'e' },
          null,
          'text',
          { id: 'f', type: 7 },
        ],
      }),
    ).toEqual(new Set(['slack.send_message']));
    expect(writeTypesUsedBy(null)).toEqual(new Set());
    expect(writeTypesUsedBy({ nodes: 'none' })).toEqual(new Set());
  });
});

describe('the allowances as a coding agent reads them [MCP-R38]', () => {
  const document = {
    version: 1,
    name: 'morning-digest',
    nodes: [
      { id: 'fetch', type: 'http.get' },
      { id: 'post', type: 'slack.send_message' },
      { id: 'file', type: 'github.create_issue' },
    ],
  };

  it('lists what is allowed, what the version writes, what a rule still requires, and who allowed what', async () => {
    onFile = ['http.send', 'slack.send_message'];
    // One rule requires a write the version makes and is allowed; another a
    // write that is allowed and no version makes; a third speaks of a write
    // that is neither, and is left out.
    governance.policy = {
      rules: [
        { action: 'slack.send_message', decision: 'require_approval' },
        { action: 'http.send', decision: 'require_approval' },
        { action: 'jira.create_issue', decision: 'require_approval' },
      ],
    };
    const view = await readApprovalAllowanceView(tx as unknown as Sql, {
      organizationId: 'org-1',
      automation: 'morning-digest',
      document,
      policyOn: await approvalPolicyOn(tx as unknown as Sql, 'org-1'),
    });
    expect(view).toEqual({
      allowed: ['http.send', 'slack.send_message'],
      used: ['github.create_issue', 'slack.send_message'],
      requiredByPolicy: ['http.send', 'slack.send_message'],
      grants: [
        {
          type: 'http.send',
          grantedBy: 'user-ada',
          grantedAt: 1_791_000_000_000,
        },
        {
          type: 'slack.send_message',
          grantedBy: 'user-ada',
          grantedAt: 1_791_000_000_000,
        },
      ],
    });
    // Whoever allowed a write is named by the door, never by an address.
    expect(JSON.stringify(view)).not.toContain('@');
    expect(statements.some((s) => s.text.includes('email'))).toBe(false);
  });

  it('reads empty for an automation that writes nothing and was allowed nothing', async () => {
    await expect(
      readApprovalAllowanceView(tx as unknown as Sql, {
        organizationId: 'org-1',
        automation: 'morning-digest',
        document: { version: 1, nodes: [{ id: 'a', type: 'http.get' }] },
        policyOn: await approvalPolicyOn(tx as unknown as Sql, 'org-1'),
      }),
    ).resolves.toEqual({
      allowed: [],
      used: [],
      requiredByPolicy: [],
      grants: [],
    });
  });

  it('says of a write what the policy decides, and nothing of one no rule speaks of', async () => {
    governance.policy = {
      rules: [
        { action: 'slack.send_message', decision: 'require_approval' },
        { connector: 'github', decision: 'auto_approve' },
      ],
    };
    const policyOn = await approvalPolicyOn(tx as unknown as Sql, 'org-1');
    expect(
      ['slack.send_message', 'github.create_issue', 'http.send'].map((type) =>
        policyOn(type),
      ),
    ).toEqual(['requires', 'allows', null]);
  });
});
