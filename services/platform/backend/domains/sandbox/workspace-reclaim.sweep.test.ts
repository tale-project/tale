// @vitest-environment node

/**
 * The reclaim as the hourly sweep runs it: after the verdicts and whatever
 * became of the inventory, through the one retire path — decided again under
 * the lock, destroyed only when stopped, audited with its reason. The rows
 * are a scripted stand-in; the real-Postgres proof is the
 * `checkWorkspaceCleanup` lane.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SandboxWorkspaceUsage } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { standingSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { loadActiveHolds } from '../legal_holds/service.ts';
import {
  runWorkspaceCleanup,
  type WorkspaceDestroyMode,
  type WorkspaceSpawner,
} from './workspace-cleanup.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../legal_holds/service.ts', () => ({ loadActiveHolds: vi.fn() }));
vi.mock('./admission-lock.ts', () => ({ lockOrgAdmission: vi.fn() }));
vi.mock('./gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(async () => {}),
}));
vi.mock('./service.ts', () => ({
  withSessionLifecycleLock: (
    sql: Sql,
    _session: unknown,
    work: (sessionSql: Sql) => Promise<unknown>,
  ) => work(sql),
}));
vi.mock('./unused-rule.ts', () => ({
  recordUnusedWorkspaceRule: vi.fn(async () => NOW - 400 * DAY),
  readUnusedRuleSince: vi.fn(async () => NOW - 400 * DAY),
}));

const GIB = 1024 ** 3;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;
const ORG = 'org-1';
const LARGE = standingSessionIdForProjectAgent('agent-large');
const SMALL = standingSessionIdForProjectAgent('agent-small');

/** The organization's rows: two idle standing workspaces, last used two
 * days ago — unless `lastUsedAt` answers otherwise for a read. */
function rows(lastUsedAt: (sessionId: string, read: number) => number) {
  const statements: string[] = [];
  const reads = new Map<string, number>();
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT "organizationId", "sessionId" FROM (')) {
      return Promise.resolve([
        { organizationId: ORG, sessionId: LARGE },
        { organizationId: ORG, sessionId: SMALL },
      ]);
    }
    if (text.includes('FROM "organization" WHERE "id" =')) {
      return Promise.resolve([{ exists: true }]);
    }
    if (text.startsWith('WITH incarnations AS')) {
      const sessionId = values.find(
        (value) => value === LARGE || value === SMALL,
      );
      if (typeof sessionId !== 'string') return Promise.resolve([]);
      const read = (reads.get(sessionId) ?? 0) + 1;
      reads.set(sessionId, read);
      return Promise.resolve([
        {
          ownerType: 'project_agent',
          ownerId: sessionId === LARGE ? 'agent-large' : 'agent-small',
          inUse: false,
          pinned: false,
          runQueued: false,
          agentExists: true,
          runStatus: null,
          runEndedAt: null,
          lastUsedAt: lastUsedAt(sessionId, read),
        },
      ]);
    }
    if (
      text.startsWith('SELECT id, status, pinned FROM app.sandbox_sessions')
    ) {
      return Promise.resolve([
        { id: 'row-1', status: 'stopped', pinned: false },
      ]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(run, {
    begin: (work: (tx: typeof run) => Promise<unknown>) => work(run),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stand-in serves only the tagged-template and begin calls the sweep makes
  return { sql: sql as unknown as Sql, statements };
}

/** A spawner with no inventory, whose disk is short: 6 GiB free of a
 * 10 GiB floor, the two workspaces measured five minutes ago. */
function spawner() {
  const destroyed: Array<[string, WorkspaceDestroyMode]> = [];
  const usage = vi.fn(async (): Promise<SandboxWorkspaceUsage> => ({
    measuredAtMs: 9_000_000,
    disk: {
      freeBytes: 6 * GIB,
      floorBytes: 10 * GIB,
      criticalBytes: 2.5 * GIB,
      short: true,
      critical: false,
    },
    workspaces: [
      { sessionId: LARGE, bytes: 30 * GIB, measuredAtMs: 8_700_000 },
      { sessionId: SMALL, bytes: 5 * GIB, measuredAtMs: 8_700_000 },
    ],
  }));
  const fake: WorkspaceSpawner = {
    destroy: async (sessionId, mode) => {
      destroyed.push([sessionId, mode]);
      return { destroyed: true, busy: false, deletion: 'done' };
    },
    inventory: async () => {
      throw new Error('sandbox workspace inventory unavailable (503)');
    },
    usage,
    teardownOrganization: async () => null,
    disconnectDevice: async () => ({}),
    revokeKey: async () => {},
    removeOrganizationFromGateway: async () => ({}),
    unpin: async () => {},
  };
  return { spawner: fake, destroyed, usage };
}

beforeEach(() => {
  vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
  vi.mocked(loadActiveHolds).mockResolvedValue({
    orgHeld: false,
    userMembershipIds: new Set(),
  });
  vi.mocked(createAuditLog).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sweep reclaims for the disk', () => {
  it('deletes the largest idle workspace, stopped only, and audits it as disk pressure with its size [SBX-R39] [SBX-R34]', async () => {
    const { sql, statements } = rows(() => NOW - 2 * DAY);
    const { spawner: fake, destroyed, usage } = spawner();
    const result = await runWorkspaceCleanup(sql, { spawner: fake, now: NOW });

    // The inventory could not be read; the reclaim ran all the same.
    expect(result.inventory).toBe('unavailable');
    expect(usage).toHaveBeenCalledWith(ORG);
    // 6 + 30 GiB clears twice the floor: the 5 GiB workspace stays.
    expect(destroyed).toEqual([[LARGE, 'stopped']]);
    expect(result.retired).toEqual({ disk_pressure: 1 });
    expect(result.reclaim).toMatchObject({
      usage: 'read',
      freedBytes: 30 * GIB,
    });
    expect(
      statements.some((text) =>
        text.startsWith("UPDATE app.sandbox_sessions SET status = 'destroyed'"),
      ),
    ).toBe(true);
    expect(vi.mocked(createAuditLog)).toHaveBeenCalledOnce();
    expect(vi.mocked(createAuditLog).mock.calls[0]?.[1]).toMatchObject({
      organizationId: ORG,
      action: 'sandbox_workspace.deleted',
      resourceId: LARGE,
      status: 'success',
      metadata: {
        reason: 'disk_pressure',
        workspaceFound: true,
        deletion: 'done',
        lastUsedAt: NOW - 2 * DAY,
        workspaceBytes: 30 * GIB,
        measuredAtMs: 8_700_000,
        diskFreeBytes: 6 * GIB,
        diskFloorBytes: 10 * GIB,
      },
    });
  });

  it('keeps a workspace used again after it was judged: the decision is taken again under the lock [SBX-R35]', async () => {
    // The sweep reads the large workspace twice (its verdict, then the
    // reclaim); the third read is the one under the lock.
    const { sql } = rows((sessionId, read) =>
      sessionId === LARGE && read >= 3 ? NOW - 60_000 : NOW - 2 * DAY,
    );
    const { spawner: fake, destroyed } = spawner();
    const result = await runWorkspaceCleanup(sql, { spawner: fake, now: NOW });
    expect(destroyed).toEqual([[SMALL, 'stopped']]);
    expect(result.retired).toEqual({ disk_pressure: 1 });
  });

  it('reclaims nothing for an organization whose policy cannot be read [SBX-R38]', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockRejectedValue(
      new Error('policy file unreadable'),
    );
    const { sql } = rows(() => NOW - 2 * DAY);
    const { spawner: fake, destroyed, usage } = spawner();
    const result = await runWorkspaceCleanup(sql, { spawner: fake, now: NOW });
    expect(usage).not.toHaveBeenCalled();
    expect(destroyed).toEqual([]);
    expect(result.reclaim.usage).toBe('skipped');
  });

  it('reclaims nothing while a hold keeps the organization [SBX-R35]', async () => {
    vi.mocked(loadActiveHolds).mockResolvedValue({
      orgHeld: true,
      userMembershipIds: new Set(),
    });
    const { sql } = rows(() => NOW - 2 * DAY);
    const { spawner: fake, destroyed, usage } = spawner();
    await runWorkspaceCleanup(sql, { spawner: fake, now: NOW });
    expect(usage).not.toHaveBeenCalled();
    expect(destroyed).toEqual([]);
  });

  it('honours an organization that switched disk reclaim off [SBX-R38]', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      deleteUnused: true,
      unusedDays: 30,
      reclaimOnDiskPressure: false,
      reclaimMinIdleHours: 24,
    });
    const { sql } = rows(() => NOW - 2 * DAY);
    const { spawner: fake, destroyed, usage } = spawner();
    await runWorkspaceCleanup(sql, { spawner: fake, now: NOW });
    expect(usage).not.toHaveBeenCalled();
    expect(destroyed).toEqual([]);
  });
});
