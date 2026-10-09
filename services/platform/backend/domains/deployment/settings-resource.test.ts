// @vitest-environment node

/**
 * The deployment's own settings over MCP, through the writer the
 * operator's settings use: the config store is a temporary directory, the
 * database a double that knows the caller's memberships and address, and
 * the audit chain a double that records.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import type { McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { getSettings } from '../mcp/settings/get.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import { deploymentSettings } from './settings-resource.ts';

const registry = { deployment: deploymentSettings };

/**
 * A caller who is `role` in their organization and signs in as `email`.
 * The database answers the gate's membership read and the address read;
 * every other statement reads nothing back.
 */
function contextOf(role: string, email: string): SettingsContext {
  const caller: McpCaller = {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: 'user-1',
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
  const tag = async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('FROM "member"')) {
      return [{ organizationId: 'org-1', role }];
    }
    if (text.includes('FROM "user"')) return [{ email }];
    return [];
  };
  const sql = Object.assign(tag, {
    begin: (work: (tx: unknown) => Promise<unknown>) => work(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, caller };
}

const OPERATOR = 'ops@example.test';
const operator = () => contextOf('owner', OPERATOR);

const change = (config: unknown) => ({
  kind: 'deployment' as const,
  op: 'set' as const,
  config,
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tale-deployment-kind-'));
  vi.stubEnv('TALE_CONFIG_DIR', dir);
  vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', OPERATOR);
  createAuditLog.mockReset();
  createAuditLog.mockResolvedValue('row-1');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('who reads and changes the deployment settings [MCP-R10]', () => {
  it('lets an admin read them, an editor on the allowlist change them, and nobody else either', async () => {
    expect(await deploymentSettings.access(operator())).toEqual({
      read: true,
      write: true,
    });
    expect(
      await deploymentSettings.access(contextOf('admin', 'ada@example.test')),
    ).toEqual({ read: true, write: false });
    expect(
      await deploymentSettings.access(contextOf('member', OPERATOR)),
    ).toEqual({ read: false, write: false });

    const refused = await planSettings(
      contextOf('admin', 'ada@example.test'),
      registry,
      [change({ version: 1 })],
    );
    expect(refused.changes[0]?.refusal).toEqual({
      code: 'FORBIDDEN_DEPLOYMENT_EDITOR',
      error: 'Your account is not in the deployment editor allowlist.',
      hint: expect.stringContaining('editor allowlist'),
    });
    const member = await getSettings(contextOf('member', OPERATOR), registry, {
      kinds: ['deployment'],
    });
    expect(member.refused).toEqual([
      expect.objectContaining({ code: 'FORBIDDEN_INSTANCE_ADMIN' }),
    ]);
  });
});

describe('planning a change of the deployment settings', () => {
  it('says that a new sandbox runtime takes effect after a restart', async () => {
    const plan = await planSettings(operator(), registry, [
      change({ version: 1, sandboxRuntime: { tier: 'gvisor' } }),
    ]);
    expect(plan.changes[0]).toMatchObject({
      action: 'create',
      effects: ['restart-required'],
      risk: 'critical',
    });
  });

  it('names every problem, a section the settings do not have among them', async () => {
    const plan = await planSettings(operator(), registry, [
      change({
        version: 2,
        sandboxRuntime: { tier: 'docker' },
        dataStores: {},
      }),
    ]);
    expect(plan.changes[0]?.refusal).toMatchObject({
      code: 'SETTINGS_INVALID',
      data: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: '/config/version' }),
          expect.objectContaining({ path: '/config/sandboxRuntime/tier' }),
        ]),
      },
    });
  });
});

describe('applying a change of the deployment settings', () => {
  it('saves through the operator’s writer and answers the hash stored', async () => {
    const answer = await applySettings(
      operator(),
      registry,
      [change({ version: 1, sandboxRuntime: { tier: 'gvisor' } })],
      { deployment: null },
    );
    const read = await deploymentSettings.read(operator(), null);
    expect(answer).toEqual({
      applied: [
        {
          kind: 'deployment',
          id: null,
          key: 'deployment',
          action: 'create',
          hash: read?.hash,
        },
      ],
      skipped: [],
    });
    expect(read?.config).toEqual({
      version: 1,
      sandboxRuntime: { tier: 'gvisor' },
    });
    expect(createAuditLog.mock.lastCall?.[1]).toMatchObject({
      action: 'deployment_config_saved',
      actorEmail: OPERATOR,
    });
  });

  it('answers a change made meanwhile as stale, with the hash stored now', async () => {
    const created = await applySettings(
      operator(),
      registry,
      [change({ version: 1 })],
      { deployment: null },
    );
    const [first] = (created.applied ?? []) as Array<{ hash: string }>;
    await writeFile(
      path.join(dir, 'deployment.yml'),
      'version: 1\nsandboxRuntime:\n  tier: kata\n',
    );
    const answer = await applySettings(
      operator(),
      registry,
      [change({ version: 1, sandboxRuntime: { tier: 'gvisor' } })],
      { deployment: first?.hash ?? null },
    );
    expect(answer).toMatchObject({
      code: 'SETTINGS_STALE',
      data: {
        currentHash: (await deploymentSettings.read(operator(), null))?.hash,
      },
    });
  });
});
