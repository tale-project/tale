// @vitest-environment node

import { DEFAULT_SANDBOX_WORKSPACES } from '@tale/shared/schemas/governance';
import { describe, expect, it } from 'vitest';

import { SandboxDeviceOfflineError } from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  leftoverVerdict,
  retireOrganizationSandboxes,
  workspaceVerdict,
  type LeftoverOwner,
  type WorkspaceFacts,
  type WorkspaceSpawner,
} from './workspace-cleanup.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function facts(overrides: Partial<WorkspaceFacts>): WorkspaceFacts {
  return {
    ownerType: 'project_agent',
    ownerId: 'agent-1',
    inUse: false,
    pinned: false,
    runQueued: false,
    agentExists: true,
    memberLeft: false,
    runStatus: null,
    runEndedAt: null,
    lastUsedAt: NOW - DAY,
    ...overrides,
  };
}

// A rule in force for a long time: only the workspace's own use counts.
const context = {
  now: NOW,
  policy: DEFAULT_SANDBOX_WORKSPACES,
  unusedRuleSince: NOW - 400 * DAY,
};

describe('workspaceVerdict', () => {
  it("deletes a deleted agent's workspace even while pinned or warm", () => {
    for (const extra of [{}, { pinned: true }, { inUse: true }]) {
      expect(
        workspaceVerdict(facts({ agentExists: false, ...extra }), context),
      ).toEqual({ retire: true, reason: 'agent_deleted', mode: 'idle' });
    }
  });

  it('deletes the workspace of a member who left even while pinned or warm', () => {
    for (const extra of [{}, { pinned: true }, { inUse: true }]) {
      expect(
        workspaceVerdict(facts({ memberLeft: true, ...extra }), context),
      ).toEqual({ retire: true, reason: 'member_removed', mode: 'idle' });
    }
  });

  it("keeps a live agent's workspace in use, pinned or about to be used", () => {
    const old = NOW - 400 * DAY;
    for (const extra of [
      { inUse: true },
      { pinned: true },
      { runQueued: true },
    ]) {
      expect(
        workspaceVerdict(facts({ lastUsedAt: old, ...extra }), context),
      ).toEqual({ retire: false });
    }
  });

  it("deletes a live agent's workspace once unused past the window", () => {
    expect(
      workspaceVerdict(facts({ lastUsedAt: NOW - 31 * DAY }), context),
    ).toEqual({ retire: true, reason: 'unused', mode: 'stopped' });
    expect(
      workspaceVerdict(facts({ lastUsedAt: NOW - 29 * DAY }), context),
    ).toEqual({ retire: false });
  });

  it('follows the organization policy: its window, or no deletion at all', () => {
    const lastUsedAt = NOW - 8 * DAY;
    expect(
      workspaceVerdict(facts({ lastUsedAt }), {
        ...context,
        policy: { deleteUnused: true, unusedDays: 7 },
      }),
    ).toEqual({ retire: true, reason: 'unused', mode: 'stopped' });
    expect(
      workspaceVerdict(facts({ lastUsedAt: NOW - 4000 * DAY }), {
        ...context,
        policy: { deleteUnused: false, unusedDays: 7 },
      }),
    ).toEqual({ retire: false });
  });

  it('waits a full window after the rule took effect before deleting for disuse', () => {
    // An upgrade, a rule turned on or a shortened window 29 days ago: a
    // workspace unused for a year still has a day left.
    const justApplied = { ...context, unusedRuleSince: NOW - 29 * DAY };
    expect(
      workspaceVerdict(facts({ lastUsedAt: NOW - 365 * DAY }), justApplied),
    ).toEqual({ retire: false });
    expect(
      workspaceVerdict(facts({ lastUsedAt: NOW - 365 * DAY }), {
        ...justApplied,
        unusedRuleSince: NOW - 31 * DAY,
      }),
    ).toEqual({ retire: true, reason: 'unused', mode: 'stopped' });
    // An owner's deletion never waits for it.
    expect(
      workspaceVerdict(facts({ agentExists: false }), justApplied),
    ).toEqual({ retire: true, reason: 'agent_deleted', mode: 'idle' });
  });

  it("keeps an automation run's workspace until the run ended an hour ago", () => {
    const run = (status: string | null, endedAgoMs: number) =>
      workspaceVerdict(
        facts({
          ownerType: 'workflow_run',
          ownerId: 'run-1:@workflow',
          runStatus: status,
          runEndedAt: status === null ? null : NOW - endedAgoMs,
        }),
        context,
      );
    expect(run('running', 3 * DAY)).toEqual({ retire: false });
    expect(run('success', 10 * 60_000)).toEqual({ retire: false });
    expect(run('failed', 2 * 60 * 60_000)).toEqual({
      retire: true,
      reason: 'orphaned',
      mode: 'stopped',
    });
    // The run's own rows went with the retention purge.
    expect(run(null, 0)).toEqual({
      retire: true,
      reason: 'orphaned',
      mode: 'stopped',
    });
  });

  it('treats a render or unknown owner as orphaned unless it is in use', () => {
    for (const ownerType of ['render', 'thread']) {
      expect(workspaceVerdict(facts({ ownerType }), context)).toEqual({
        retire: true,
        reason: 'orphaned',
        mode: 'stopped',
      });
      expect(
        workspaceVerdict(facts({ ownerType, inUse: true }), context),
      ).toEqual({ retire: false });
    }
  });
});

describe('leftoverVerdict', () => {
  const leftover = (
    sessionId: string,
    owner: LeftoverOwner,
    agentExists = false,
  ) => leftoverVerdict({ sessionId, owner, agentExists });

  it("deletes a workspace no row names only when it is this deployment's", () => {
    for (const sessionId of ['pa-agent-1', 'wf-run-1-abc']) {
      expect(leftover(sessionId, 'ours')).toBe(true);
      expect(leftover(sessionId, 'deleted')).toBe(true);
      // Another deployment's on a shared spawner or namespace, or one the
      // spawner cannot attribute: never guessed at.
      expect(leftover(sessionId, 'foreign')).toBe(false);
      expect(leftover(sessionId, 'unknown')).toBe(false);
    }
  });

  it("keeps a project agent's workspace while its agent exists", () => {
    expect(leftover('pa-agent-1', 'ours', true)).toBe(false);
  });

  it("deletes a crawler render's wherever it ran", () => {
    for (const owner of ['ours', 'deleted', 'foreign', 'unknown'] as const) {
      expect(leftover('rnd-0123456789abcdef', owner)).toBe(true);
    }
  });
});

function scriptedSpawner(script: {
  offline?: ReadonlySet<string>;
  failKeys?: ReadonlySet<string>;
}) {
  const calls: string[] = [];
  const spawner: WorkspaceSpawner = {
    destroy: async (sessionId, mode) => {
      calls.push(`destroy ${sessionId} ${mode}`);
      if (script.offline?.has(sessionId)) {
        throw new SandboxDeviceOfflineError('device-1');
      }
      return { destroyed: true, busy: false };
    },
    inventory: async () => null,
    teardownOrganization: async (organizationId) => {
      calls.push(`teardown ${organizationId}`);
      return {};
    },
    disconnectDevice: async (deviceId) => {
      calls.push(`disconnect ${deviceId}`);
      return {};
    },
    revokeKey: async (keyId) => {
      calls.push(`revoke ${keyId}`);
      if (script.failKeys?.has(keyId)) throw new Error('gateway down');
    },
    unpin: async (sessionId) => {
      calls.push(`unpin ${sessionId}`);
    },
  };
  return { spawner, calls };
}

describe('retireOrganizationSandboxes', () => {
  const payload = {
    organizationId: 'org-gone',
    sessionIds: ['pa-1', 'wf-2'],
    gatewayKeyIds: ['key-1'],
    deviceIds: ['device-1'],
    teardown: true,
  };

  const alone = { otherSlicesPending: async () => 0 };

  it('destroys every workspace whatever runs in it, then tears the organization down', async () => {
    const { spawner, calls } = scriptedSpawner({});
    await retireOrganizationSandboxes(payload, { ...alone, spawner });
    expect(calls).toEqual([
      'revoke key-1',
      'destroy pa-1 force',
      'destroy wf-2 force',
      'disconnect device-1',
      'teardown org-gone',
    ]);
  });

  it('keeps its devices while a workspace on one is out of reach, and throws for a retry', async () => {
    const { spawner, calls } = scriptedSpawner({
      offline: new Set(['pa-1']),
      failKeys: new Set(['key-1']),
    });
    await expect(
      retireOrganizationSandboxes(payload, { ...alone, spawner }),
    ).rejects.toThrow(/key key-1.*pa-1 \(offline\)/);
    // The hub still knows where pa-1 lives: letting go of the device now
    // would strand its workspace on the machine.
    expect(calls).toEqual([
      'revoke key-1',
      'destroy pa-1 force',
      'destroy wf-2 force',
    ]);
  });

  it('leaves the devices and the teardown to the last slice of a split organization', async () => {
    const { spawner, calls } = scriptedSpawner({});
    await retireOrganizationSandboxes(
      { ...payload, gatewayKeyIds: [], deviceIds: [], teardown: false },
      { ...alone, spawner },
    );
    expect(calls).toEqual(['destroy pa-1 force', 'destroy wf-2 force']);
  });

  it('lets go of the devices only once every other slice has finished', async () => {
    // A device's workspaces are reachable only while the hub knows it: a
    // slice still destroying some must not lose it under them.
    const { spawner, calls } = scriptedSpawner({});
    let pending = 2;
    const last = { ...payload, gatewayKeyIds: [] };
    const deps = { spawner, otherSlicesPending: async () => pending };
    await expect(retireOrganizationSandboxes(last, deps)).rejects.toThrow(
      /2 other slice\(s\) still running/,
    );
    expect(calls).toEqual(['destroy pa-1 force', 'destroy wf-2 force']);
    pending = 0;
    calls.length = 0;
    await retireOrganizationSandboxes(last, deps);
    expect(calls).toEqual([
      'destroy pa-1 force',
      'destroy wf-2 force',
      'disconnect device-1',
      'teardown org-gone',
    ]);
  });
});
