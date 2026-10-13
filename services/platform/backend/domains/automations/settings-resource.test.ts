// @vitest-environment node

/**
 * What an automation may do without approval, over MCP, through the
 * settings registry's own read, plan and apply. The database is a double
 * that keeps the allowances and answers the writer's statements the way
 * Postgres would, so the hash a read answers and the hash the writer
 * checks come from the real code on both sides; the store that hides what
 * a person cannot see, and the audit chain, are doubles.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigurationError } from '../../core/lib/config_store/precondition.ts';
import { callerOrigin, type McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { getSettings } from '../mcp/settings/get.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type {
  SettingsChange,
  SettingsContext,
} from '../mcp/settings/registry.ts';
import { approvalAllowanceHash } from './approval-allowances.ts';
import { auditDefinitionWrite } from './audit.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import { automationApprovalSettings } from './settings-resource.ts';

vi.mock('./audit.ts', () => ({ auditDefinitionWrite: vi.fn() }));

interface Grant {
  type: string;
  grantedBy: string;
  grantedAt: number;
}

/** What the database holds, and what the caller may see of it. */
const world = vi.hoisted(() => ({
  automations: new Map<string, { document: unknown; grants: Grant[] }>(),
  hidden: new Set<string>(),
  /** Members of the organization, by user id; a name or none. */
  members: new Map<string, string | null>(),
  policy: null as unknown,
  hints: 0,
}));

vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  readGovernancePolicyForOrg: () => Promise.resolve(world.policy),
}));
vi.mock('./dispatch-store.ts', () => ({
  pgAutomationStore: vi.fn(() => ({
    get: async (name: string) => {
      const stored = world.automations.get(name);
      return stored === undefined || world.hidden.has(name)
        ? null
        : { meta: { version: 3 }, automation: stored.document };
    },
    list: async () =>
      [...world.automations.keys()]
        .filter((name) => !world.hidden.has(name))
        .map((name) => ({
          name,
          latest: 3,
          deployedVersion: null,
          projectIds: [],
        })),
  })),
}));

const ORG = 'org-1';

const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
  const grants = (name: unknown) =>
    world.automations.get(String(name))?.grants ?? [];
  if (text.includes('FROM app.automations')) {
    return Promise.resolve(
      world.automations.has(String(values[1])) ? [{ found: 1 }] : [],
    );
  }
  if (text.startsWith('SELECT connector, action')) {
    return Promise.resolve(
      grants(values[1]).map((grant) => {
        const [connector, action] = grant.type.split('.');
        return {
          connector,
          action,
          grantedBy: grant.grantedBy,
          grantedAt: grant.grantedAt,
          note: null,
        };
      }),
    );
  }
  if (text.startsWith('SELECT DISTINCT automation_name')) {
    return Promise.resolve(
      [...world.automations]
        .filter(([, stored]) => stored.grants.length > 0)
        .map(([name]) => ({ name })),
    );
  }
  if (text.startsWith('SELECT u.id, u.name FROM "user" u')) {
    const asked = values[1] as string[];
    return Promise.resolve(
      [...world.members]
        .filter(([id]) => asked.includes(id))
        .map(([id, name]) => ({ id, name })),
    );
  }
  if (text.startsWith('INSERT INTO app.automation_approval_allowances')) {
    grants(values[1]).push({
      type: `${String(values[2])}.${String(values[3])}`,
      grantedBy: String(values[4]),
      grantedAt: Number(values[5]),
    });
  }
  if (text.startsWith('DELETE FROM app.automation_approval_allowances')) {
    const stored = world.automations.get(String(values[1]));
    if (stored !== undefined) {
      stored.grants = stored.grants.filter(
        (grant) => grant.type !== `${String(values[2])}.${String(values[3])}`,
      );
    }
  }
  if (text.startsWith('INSERT INTO app_realtime.outbox')) world.hints += 1;
  return Promise.resolve([]);
};
const fakeSql = Object.assign(tag, {
  begin: async (work: (transaction: unknown) => unknown) => work(tag),
});

const callerOf = (role: string): McpCaller => ({
  organizationId: ORG,
  orgSlug: 'acme',
  userId: `user-${role}`,
  role,
  credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  clientName: 'Claude Code',
});

function contextOf(role: string): SettingsContext {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: fakeSql as unknown as Sql, caller: callerOf(role) };
}

const registry = { 'automation-approval': automationApprovalSettings };

const DIGEST = {
  version: 1,
  name: 'morning-digest',
  nodes: [
    { id: 'fetch', type: 'http.get' },
    { id: 'post', type: 'slack.send_message' },
    { id: 'file', type: 'github.create_issue' },
  ],
};

const KEY = 'automation-approval/morning-digest';

const act = (
  name: string,
  which: 'grant' | 'revoke',
  args: unknown,
): SettingsChange => ({
  kind: 'automation-approval',
  id: name,
  op: 'act',
  act: which,
  args,
});

/** The hash a read of the automation's allowances answers. */
const hashOf = (...types: string[]) =>
  approvalAllowanceHash('morning-digest', types);

const read = async (role: string, ids: string[]) =>
  getSettings(contextOf(role), registry, {
    kinds: ['automation-approval'],
    ids,
  });

/** What was written to the allowances table, in the order it happened. */
const grantsOf = (name: string) =>
  (world.automations.get(name)?.grants ?? []).map((grant) => grant.type);

beforeEach(() => {
  world.automations = new Map([
    [
      'morning-digest',
      {
        document: DIGEST,
        grants: [
          {
            type: 'slack.send_message',
            grantedBy: 'user-ada',
            grantedAt: 1_791_000_000_000,
          },
        ],
      },
    ],
    [
      'ops/cleanup',
      {
        document: { version: 1, nodes: [{ id: 'a', type: 'http.get' }] },
        grants: [],
      },
    ],
    ['hidden/flow', { document: DIGEST, grants: [] }],
  ]);
  world.hidden = new Set(['hidden/flow']);
  world.members = new Map([['user-ada', 'Ada Lovelace']]);
  world.policy = null;
  world.hints = 0;
  vi.mocked(auditDefinitionWrite).mockReset();
  vi.mocked(pgAutomationStore).mockClear();
});

describe('who reads and changes what an automation may do without approval [MCP-R38]', () => {
  it('lets owners and admins read and change it, developers read it, and every other member neither', async () => {
    for (const role of ['owner', 'admin']) {
      expect(await automationApprovalSettings.access(contextOf(role))).toEqual({
        read: true,
        write: true,
      });
    }
    expect(
      await automationApprovalSettings.access(contextOf('developer')),
    ).toEqual({ read: true, write: false });
    expect(
      await automationApprovalSettings.access(contextOf('member')),
    ).toEqual({ read: false, write: false });
  });

  it('refuses a member’s read as a refusal beside the others, never as an empty answer', async () => {
    const answer = await read('member', ['morning-digest']);
    expect(answer.resources).toEqual([]);
    expect(answer.refused).toEqual([
      {
        kind: 'automation-approval',
        code: 'FORBIDDEN',
        error:
          'Only owners, admins and developers can read what an automation may do without approval.',
        hint: expect.stringContaining('an owner or admin can change it'),
      },
    ]);
  });

  it('refuses a developer’s change when it is planned and when it is applied, writing nothing', async () => {
    const change = act('morning-digest', 'grant', {
      types: ['github.create_issue'],
    });
    const plan = await planSettings(contextOf('developer'), registry, [change]);
    expect(plan.ok).toBe(false);
    expect(plan.changes[0]?.refusal).toMatchObject({ code: 'FORBIDDEN' });
    const applied = await applySettings(
      contextOf('developer'),
      registry,
      [change],
      { [KEY]: hashOf('slack.send_message') },
    );
    expect(applied).toMatchObject({
      code: 'FORBIDDEN',
      applied: [],
      failed: { key: KEY },
    });
    expect(grantsOf('morning-digest')).toEqual(['slack.send_message']);
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
  });
});

describe('reading what an automation may do without approval [MCP-R38]', () => {
  it('reads what is allowed, what the version writes, what a rule still requires, and who allowed what, by name', async () => {
    world.policy = {
      rules: [{ action: 'slack.send_message', decision: 'require_approval' }],
    };
    const answer = await read('developer', ['morning-digest']);
    expect(answer.resources).toEqual([
      {
        kind: 'automation-approval',
        id: 'morning-digest',
        key: KEY,
        hash: hashOf('slack.send_message'),
        config: {
          automation: 'morning-digest',
          allowed: ['slack.send_message'],
          used: ['github.create_issue', 'slack.send_message'],
          requiredByPolicy: ['slack.send_message'],
          grants: [
            {
              type: 'slack.send_message',
              grantedBy: 'user-ada',
              grantedByName: 'Ada Lovelace',
              grantedAt: 1_791_000_000_000,
            },
          ],
        },
      },
    ]);
  });

  it('names no one who left the organization, and never an address', async () => {
    world.members = new Map();
    const answer = await read('developer', ['morning-digest']);
    expect(answer.resources).toEqual([
      expect.objectContaining({
        config: expect.objectContaining({
          grants: [
            expect.objectContaining({
              grantedBy: 'user-ada',
              grantedByName: null,
            }),
          ],
        }),
      }),
    ]);
    expect(JSON.stringify(answer)).not.toContain('@');
  });

  it('reads an automation that holds nothing as an empty set, and one the person cannot see, or that does not exist, as nothing', async () => {
    const answer = await read('admin', [
      'ops/cleanup',
      'hidden/flow',
      'never/made',
    ]);
    expect(answer.refused).toEqual([]);
    expect(answer.resources).toEqual([
      {
        kind: 'automation-approval',
        id: 'ops/cleanup',
        key: 'automation-approval/ops/cleanup',
        hash: approvalAllowanceHash('ops/cleanup', []),
        config: {
          automation: 'ops/cleanup',
          allowed: [],
          used: [],
          requiredByPolicy: [],
          grants: [],
        },
      },
    ]);
  });

  it('reads as the person over MCP, who sees only what the app would show them', async () => {
    await read('admin', ['morning-digest']);
    expect(pgAutomationStore).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      origin: callerOrigin(callerOf('admin')),
      visibleOnly: true,
    });
  });

  it('lists the visible automations that hold an allowance, by name, a page at a time', async () => {
    world.automations.set('hidden/flow', {
      document: DIGEST,
      grants: [
        {
          type: 'http.send',
          grantedBy: 'user-ada',
          grantedAt: 1_791_000_000_000,
        },
      ],
    });
    for (let index = 0; index < 52; index += 1) {
      world.automations.set(`bulk/a${String(index).padStart(2, '0')}`, {
        document: { version: 1, nodes: [] },
        grants: [
          {
            type: 'http.send',
            grantedBy: 'user-ada',
            grantedAt: 1_791_000_000_000,
          },
        ],
      });
    }
    const first = await getSettings(contextOf('admin'), registry, {
      kinds: ['automation-approval'],
    });
    const ids = (answer: { resources?: unknown }) =>
      (answer.resources as Array<{ id: string }>).map((entry) => entry.id);
    // 52 bulk ones and the digest: the hidden automation holds an allowance
    // too, and is left out; ops/cleanup holds none.
    expect(ids(first)).toHaveLength(50);
    expect(ids(first)[0]).toBe('bulk/a00');
    expect(first.cursors).toEqual({
      'automation-approval': expect.stringMatching(/^automation-approval:p50$/),
    });
    const second = await getSettings(contextOf('admin'), registry, {
      kinds: ['automation-approval'],
      cursor: (first.cursors as Record<string, string>)['automation-approval'],
    });
    expect(ids(second)).toEqual(['bulk/a50', 'bulk/a51', 'morning-digest']);
    expect(second.cursors).toEqual({});
  });

  it('refuses a name that is no automation name, and a change that names none', async () => {
    const plan = await planSettings(contextOf('admin'), registry, [
      act('Not A Name!', 'grant', { types: ['http.send'] }),
      act('morning-digest ', 'grant', { types: ['http.send'] }),
      {
        kind: 'automation-approval',
        op: 'act',
        act: 'grant',
        args: { types: ['http.send'] },
      },
    ]);
    expect(plan.changes.map((entry) => entry.refusal?.code)).toEqual([
      'SETTINGS_ID_INVALID',
      'SETTINGS_ID_INVALID',
      'SETTINGS_ID_REQUIRED',
    ]);
  });
});

describe('planning what an automation may do without approval [MCP-R39]', () => {
  const plan = async (change: SettingsChange, role = 'admin') =>
    (await planSettings(contextOf(role), registry, [change])).changes[0];

  it('plans allowing a write as removing a person from its runs, with the set it leaves', async () => {
    const planned = await plan(
      act('morning-digest', 'grant', { types: ['github.create_issue'] }),
    );
    expect(planned).toMatchObject({
      key: KEY,
      op: 'act',
      act: 'grant',
      action: 'act',
      currentHash: hashOf('slack.send_message'),
      diff: [
        {
          path: '/allowed',
          before: ['slack.send_message'],
          after: ['github.create_issue', 'slack.send_message'],
        },
      ],
      effects: ['removes-human-approval'],
      risk: 'critical',
    });
  });

  it('plans allowing a write a rule of the policy already decides with no effect, the rule still winning', async () => {
    world.policy = {
      rules: [
        { action: 'github.create_issue', decision: 'require_approval' },
        { connector: 'http', decision: 'auto_approve' },
      ],
    };
    const planned = await plan(
      act('morning-digest', 'grant', {
        types: ['github.create_issue', 'http.send'],
      }),
    );
    expect(planned).toMatchObject({
      action: 'act',
      effects: [],
      risk: 'high',
    });
    expect(planned?.diff).toEqual([
      expect.objectContaining({ path: '/allowed' }),
    ]);
  });

  it('plans a withdrawal with no effect: a person approves again', async () => {
    const planned = await plan(
      act('morning-digest', 'revoke', { types: ['slack.send_message'] }),
    );
    expect(planned).toMatchObject({
      action: 'act',
      diff: [{ path: '/allowed', before: ['slack.send_message'], after: [] }],
      effects: [],
      risk: 'high',
    });
  });

  it('plans a change that changes nothing as unchanged, with no effect', async () => {
    for (const change of [
      act('morning-digest', 'grant', { types: ['slack.send_message'] }),
      act('morning-digest', 'revoke', { types: ['github.create_issue'] }),
    ]) {
      expect(await plan(change)).toMatchObject({
        action: 'unchanged',
        diff: [],
        effects: [],
        risk: 'low',
      });
    }
  });

  it('refuses anything that is no write to an outside system, naming it, and a name no one has allowed', async () => {
    world.automations.get('morning-digest')?.grants.push({
      type: 'legacy.removed',
      grantedBy: 'user-ada',
      grantedAt: 1_791_000_000_000,
    });
    const refused = await plan(
      act('morning-digest', 'grant', {
        types: ['github.create_issue', 'http.get', 'task.create', 'made.up'],
      }),
    );
    expect(refused?.refusal).toMatchObject({
      code: 'APPROVAL_ALLOWANCE_INVALID',
      data: { types: ['http.get', 'task.create', 'made.up'] },
    });
    // An allowance whose action the catalog lost can still be withdrawn.
    expect(
      await plan(
        act('morning-digest', 'revoke', { types: ['legacy.removed'] }),
      ),
    ).toMatchObject({ action: 'act', effects: [] });
    expect(
      (
        await plan(
          act('morning-digest', 'revoke', {
            types: ['legacy.removed', 'made.up'],
          }),
        )
      )?.refusal,
    ).toMatchObject({
      code: 'APPROVAL_ALLOWANCE_INVALID',
      data: { types: ['made.up'] },
    });
  });

  it('refuses arguments the act does not take, pointing at each problem', async () => {
    const issues = async (args: unknown) =>
      (await plan(act('morning-digest', 'grant', args)))?.refusal?.data?.issues;
    expect(await issues({ types: [] })).toEqual([
      expect.objectContaining({ path: '/args/types' }),
    ]);
    expect(await issues({ types: ['a.b'], extra: 1 })).toEqual([
      expect.objectContaining({ path: '/args' }),
    ]);
    expect(await issues({ types: ['x'] })).toEqual([
      expect.objectContaining({ path: '/args/types/0' }),
    ]);
    expect(
      await issues({
        types: Array.from({ length: 51 }, (_, index) => `slack.send${index}`),
      }),
    ).toEqual([expect.objectContaining({ path: '/args/types' })]);
    expect(await issues(undefined)).toEqual([
      expect.objectContaining({ path: '/args' }),
    ]);
  });

  it('refuses a change to an automation the person cannot see or that does not exist as one to act on', async () => {
    for (const name of ['hidden/flow', 'never/made']) {
      expect(
        (await plan(act(name, 'grant', { types: ['http.send'] })))?.refusal,
      ).toMatchObject({ code: 'SETTINGS_NOT_FOUND' });
    }
  });

  it('refuses a change that is no act, and an act on nothing, when its kind is asked directly', async () => {
    const ctx = contextOf('admin');
    await expect(
      automationApprovalSettings.plan(
        ctx,
        {
          kind: 'automation-approval',
          id: 'morning-digest',
          op: 'set',
          config: {},
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'SETTINGS_INVALID' });
    await expect(
      automationApprovalSettings.plan(
        ctx,
        act('morning-digest', 'grant', { types: ['http.send'] }),
        null,
      ),
    ).rejects.toMatchObject({ code: 'SETTINGS_NOT_FOUND', status: 404 });
  });
});

describe('changing what an automation may do without approval [MCP-R39]', () => {
  it('allows a write through the tab’s writer: one audit row made over MCP, the person recorded, the hash of the set it leaves', async () => {
    const applied = await applySettings(
      contextOf('admin'),
      registry,
      [act('morning-digest', 'grant', { types: ['github.create_issue'] })],
      { [KEY]: hashOf('slack.send_message') },
    );
    expect(applied).toEqual({
      applied: [
        {
          kind: 'automation-approval',
          id: 'morning-digest',
          key: KEY,
          action: 'act',
          hash: hashOf('github.create_issue', 'slack.send_message'),
        },
      ],
      skipped: [],
    });
    expect(grantsOf('morning-digest')).toEqual([
      'slack.send_message',
      'github.create_issue',
    ]);
    expect(
      world.automations
        .get('morning-digest')
        ?.grants.find((grant) => grant.type === 'github.create_issue')
        ?.grantedBy,
    ).toBe('user-admin');
    expect(auditDefinitionWrite).toHaveBeenCalledTimes(1);
    expect(vi.mocked(auditDefinitionWrite).mock.calls[0]?.[1]).toMatchObject({
      organizationId: ORG,
      action: 'automation.approval_allowance.granted',
      name: 'morning-digest',
      newState: { type: 'github.create_issue' },
      origin: {
        via: 'mcp',
        actor: 'api-key:user-admin',
        apiKeyId: 'key-laptop',
        clientName: 'Claude Code',
      },
    });
    expect(world.hints).toBe(1);
    // What the change answered is what the next read answers.
    const after = await read('admin', ['morning-digest']);
    expect(after.resources).toEqual([
      expect.objectContaining({
        hash: hashOf('github.create_issue', 'slack.send_message'),
      }),
    ]);
  });

  it('withdraws only what it names, and leaves who allowed the rest', async () => {
    world.automations.get('morning-digest')?.grants.push({
      type: 'http.send',
      grantedBy: 'user-bob',
      grantedAt: 1_792_000_000_000,
    });
    const applied = await applySettings(
      contextOf('owner'),
      registry,
      [act('morning-digest', 'revoke', { types: ['slack.send_message'] })],
      { [KEY]: hashOf('http.send', 'slack.send_message') },
    );
    expect(applied).toMatchObject({
      applied: [{ action: 'act', hash: hashOf('http.send') }],
    });
    expect(world.automations.get('morning-digest')?.grants).toEqual([
      {
        type: 'http.send',
        grantedBy: 'user-bob',
        grantedAt: 1_792_000_000_000,
      },
    ]);
    expect(vi.mocked(auditDefinitionWrite).mock.calls[0]?.[1]).toMatchObject({
      action: 'automation.approval_allowance.revoked',
      previousState: { type: 'slack.send_message' },
    });
  });

  it('writes and audits nothing for a change that changes nothing, and answers it as unchanged', async () => {
    const applied = await applySettings(
      contextOf('admin'),
      registry,
      [act('morning-digest', 'grant', { types: ['slack.send_message'] })],
      { [KEY]: hashOf('slack.send_message') },
    );
    expect(applied).toEqual({
      applied: [
        {
          kind: 'automation-approval',
          id: 'morning-digest',
          key: KEY,
          action: 'unchanged',
          hash: hashOf('slack.send_message'),
        },
      ],
      skipped: [],
    });
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
    expect(world.hints).toBe(0);
  });

  it('applies nothing to a set that moved since it was read, answering the hash it holds now', async () => {
    const readHash = hashOf('slack.send_message');
    // Another person allows a write meanwhile.
    world.automations.get('morning-digest')?.grants.push({
      type: 'http.send',
      grantedBy: 'user-bob',
      grantedAt: 1_792_000_000_000,
    });
    const applied = await applySettings(
      contextOf('admin'),
      registry,
      [act('morning-digest', 'grant', { types: ['github.create_issue'] })],
      { [KEY]: readHash },
    );
    expect(applied).toMatchObject({
      code: 'SETTINGS_STALE',
      data: { currentHash: hashOf('http.send', 'slack.send_message') },
      applied: [],
    });
    expect(grantsOf('morning-digest')).toEqual([
      'slack.send_message',
      'http.send',
    ]);
    expect(auditDefinitionWrite).not.toHaveBeenCalled();
  });

  it('has the writer refuse a set that moved after the change was planned', async () => {
    const change = act('morning-digest', 'grant', {
      types: ['github.create_issue'],
    });
    await expect(
      automationApprovalSettings.apply(
        contextOf('admin'),
        change,
        hashOf('http.send'),
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(grantsOf('morning-digest')).toEqual(['slack.send_message']);
  });

  it('allows a write on an automation the person cannot see as nothing to act on, writing nothing', async () => {
    const applied = await applySettings(
      contextOf('admin'),
      registry,
      [act('hidden/flow', 'grant', { types: ['http.send'] })],
      {
        'automation-approval/hidden/flow': approvalAllowanceHash(
          'hidden/flow',
          [],
        ),
      },
    );
    expect(applied).toMatchObject({ code: 'SETTINGS_NOT_FOUND', applied: [] });
    expect(grantsOf('hidden/flow')).toEqual([]);
  });
});
