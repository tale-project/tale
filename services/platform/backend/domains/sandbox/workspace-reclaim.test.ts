// @vitest-environment node

import {
  DEFAULT_SANDBOX_WORKSPACES,
  type SandboxWorkspacesConfig,
} from '@tale/shared/schemas/governance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SandboxWorkspaceUsage } from '../../core/node_only/sandbox/helpers/session_client.ts';
import type { WorkspaceRetireOutcome } from './workspace-cleanup.ts';
import {
  diskShort,
  freesBytes,
  idleForReclaim,
  reclaimTarget,
  reclaimWorkspaces,
  sizeCapBytes,
  trustedBytes,
  type IdleFacts,
  type ReclaimIo,
  type ReclaimReason,
} from './workspace-reclaim.ts';

const GIB = 1024 ** 3;
const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
/** When the spawner answers, on its own clock (never compared with NOW). */
const ANSWERED = 5_000_000_000;

function idle(overrides: Partial<IdleFacts> = {}): IdleFacts {
  return {
    ownerType: 'project_agent',
    agentExists: true,
    memberLeft: false,
    inUse: false,
    pinned: false,
    runQueued: false,
    lastUsedAt: NOW - 48 * HOUR,
    ...overrides,
  };
}

/** The workspaces' disk, in GiB: below its floor reads short. */
function disk(freeGiB: number, floorGiB = 10) {
  return {
    freeBytes: freeGiB * GIB,
    floorBytes: floorGiB * GIB,
    criticalBytes: (floorGiB / 4) * GIB,
    short: freeGiB < floorGiB,
    critical: freeGiB < floorGiB / 4,
  };
}

interface Workspace {
  /** Measured size in GiB; null while unmeasured. */
  gib: number | null;
  /** How long before the answer it was measured; null when never. */
  measuredAgoMs?: number | null;
  /** Its rows' facts; null when no row of the organization holds it. */
  facts?: IdleFacts | null;
}

interface Organization {
  id: string;
  policy?: Partial<SandboxWorkspacesConfig>;
  held?: string[];
  workspaces: Record<string, Workspace>;
}

/** A scripted sweep: the organizations, the disk the spawner reads, and
 * what each deletion answers (`destroyed` unless scripted). */
function sweep(script: {
  disk: ReturnType<typeof disk> | null;
  organizations: Organization[];
  outcomes?: Record<string, WorkspaceRetireOutcome>;
  usage?: (organizationId: string) => Promise<SandboxWorkspaceUsage | null>;
  /** Spent after this many deletions. */
  bound?: number;
}) {
  const asked: string[] = [];
  const retired: Array<{
    sessionId: string;
    reason: ReclaimReason;
    detail: Record<string, unknown>;
  }> = [];
  const organizationOf = (id: string) => {
    const organization = script.organizations.find((o) => o.id === id);
    if (organization === undefined) throw new Error(`unknown ${id}`);
    return organization;
  };
  const io: ReclaimIo = {
    organizations: async () =>
      script.organizations.map((organization) => ({
        organizationId: organization.id,
        policy: { ...DEFAULT_SANDBOX_WORKSPACES, ...organization.policy },
        held: (sessionId) => organization.held?.includes(sessionId) ?? false,
      })),
    usage: async (organizationId) => {
      asked.push(organizationId);
      if (script.usage !== undefined) return script.usage(organizationId);
      return {
        measuredAtMs: ANSWERED,
        disk: script.disk,
        workspaces: Object.entries(
          organizationOf(organizationId).workspaces,
        ).map(([sessionId, workspace]) => ({
          sessionId,
          bytes: workspace.gib === null ? null : workspace.gib * GIB,
          measuredAtMs:
            workspace.measuredAgoMs === null
              ? null
              : ANSWERED - (workspace.measuredAgoMs ?? 5 * 60_000),
        })),
      };
    },
    facts: async (organizationId, sessionId) => {
      const facts = organizationOf(organizationId).workspaces[sessionId]?.facts;
      return facts === undefined ? idle() : facts;
    },
    retire: async (candidate, reason, detail) => {
      retired.push({ sessionId: candidate.sessionId, reason, detail });
      return script.outcomes?.[candidate.sessionId] ?? 'destroyed';
    },
    exhausted: () =>
      script.bound !== undefined && retired.length >= script.bound,
  };
  return {
    run: () => reclaimWorkspaces(io, NOW),
    asked,
    retired,
    order: () => retired.map((entry) => `${entry.sessionId} ${entry.reason}`),
  };
}

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('which workspace is idle enough to go for its room', () => {
  it("takes a live agent's workspace nobody used for the organization's idle hours [SBX-R35]", () => {
    expect(idleForReclaim(idle(), DEFAULT_SANDBOX_WORKSPACES, NOW)).toBe(true);
    const recent = idle({ lastUsedAt: NOW - 23 * HOUR });
    expect(idleForReclaim(recent, DEFAULT_SANDBOX_WORKSPACES, NOW)).toBe(false);
    expect(idleForReclaim(recent, { reclaimMinIdleHours: 6 }, NOW)).toBe(true);
  });

  it('never takes one in use, pinned, about to be used, or one the verdict takes for its owner [SBX-R35]', () => {
    for (const overrides of [
      { inUse: true },
      { pinned: true },
      { runQueued: true },
      { agentExists: false },
      { memberLeft: true },
      { ownerType: 'workflow_run' },
    ]) {
      expect(
        idleForReclaim(idle(overrides), DEFAULT_SANDBOX_WORKSPACES, NOW),
      ).toBe(false);
    }
  });
});

describe('which size stands for a workspace', () => {
  const idleFor = 48 * HOUR;

  it('trusts only a measurement taken after the workspace was last used [SBX-R36]', () => {
    const at = (agoMs: number) => ({
      bytes: 30 * GIB,
      measuredAtMs: ANSWERED - agoMs,
    });
    expect(trustedBytes(at(10 * 60_000), ANSWERED, idleFor)).toBe(30 * GIB);
    // Measured before the last use: the files may have grown since.
    expect(trustedBytes(at(49 * HOUR), ANSWERED, idleFor)).toBeNull();
    // A measurement stamped after the answer reads as just taken.
    expect(trustedBytes(at(-1000), ANSWERED, idleFor)).toBe(30 * GIB);
  });

  it('reads no size at all as no size, never as zero [SBX-R36]', () => {
    expect(
      trustedBytes({ bytes: null, measuredAtMs: ANSWERED }, ANSWERED, idleFor),
    ).toBeNull();
    expect(
      trustedBytes({ bytes: 30 * GIB, measuredAtMs: null }, ANSWERED, idleFor),
    ).toBeNull();
  });
});

describe('the room the disk needs', () => {
  it('works back to twice the floor, and acts below the floor or the critical tier only [SBX-R34]', () => {
    expect(reclaimTarget(disk(6))).toBe(20 * GIB);
    expect(diskShort(disk(6))).toBe(true);
    expect(diskShort({ ...disk(12), critical: true })).toBe(true);
    expect(diskShort(disk(12))).toBe(false);
    expect(diskShort(null)).toBe(false);
  });

  it('counts what a deletion frees once its workspace is out of use [SBX-R34]', () => {
    expect(freesBytes('destroyed')).toBe(true);
    expect(freesBytes('deleting')).toBe(true);
    for (const outcome of [
      'absent',
      'kept',
      'busy',
      'offline',
      'failed',
      'deletion_failed',
      'deletion_unconfirmed',
    ] as const) {
      expect(freesBytes(outcome)).toBe(false);
    }
  });

  it('caps a workspace at the whole GiB the organization set, or not at all [SBX-R37]', () => {
    expect(sizeCapBytes({ maxWorkspaceGiB: 30 })).toBe(30 * GIB);
    expect(sizeCapBytes({})).toBeNull();
  });
});

describe('reclaimWorkspaces', () => {
  it("deletes the host's largest idle workspaces first, whichever organization holds them, until twice the floor is free [SBX-R34]", async () => {
    // 1 GiB free of a 10 GiB floor: 19 GiB to find.
    const run = sweep({
      disk: disk(1),
      organizations: [
        { id: 'org-a', workspaces: { a1: { gib: 12 }, a2: { gib: 3 } } },
        { id: 'org-b', workspaces: { b1: { gib: 9 }, b2: { gib: 5 } } },
      ],
    });
    const result = await run.run();
    expect(run.order()).toEqual(['a1 disk_pressure', 'b1 disk_pressure']);
    expect(run.asked).toEqual(['org-a', 'org-b']);
    expect(result).toMatchObject({ usage: 'read', freedBytes: 21 * GIB });
    expect(run.retired[1]?.detail).toEqual({
      lastUsedAt: NOW - 48 * HOUR,
      workspaceBytes: 9 * GIB,
      measuredAtMs: ANSWERED - 5 * 60_000,
      diskFreeBytes: 13 * GIB,
      diskFloorBytes: 10 * GIB,
    });
    expect(log).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it('goes on to the next largest while a deletion frees nothing yet, and says when the disk stays short [SBX-R34]', async () => {
    const run = sweep({
      disk: disk(1),
      organizations: [
        { id: 'org-a', workspaces: { a1: { gib: 12 }, a2: { gib: 3 } } },
        { id: 'org-b', workspaces: { b1: { gib: 9 }, b2: { gib: 5 } } },
      ],
      outcomes: { a1: 'busy', b1: 'deleting', a2: 'kept' },
    });
    const result = await run.run();
    expect(run.order()).toEqual([
      'a1 disk_pressure',
      'b1 disk_pressure',
      'b2 disk_pressure',
      'a2 disk_pressure',
    ]);
    // b1 is out of use and its bytes are going; a1 and a2 stay.
    expect(result.freedBytes).toBe(14 * GIB);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('the sandbox workspace disk stays short'),
    );
  });

  it('asks no other organization once the disk has room, and deletes nothing for it', async () => {
    const run = sweep({
      disk: disk(50),
      organizations: [
        { id: 'org-a', workspaces: { a1: { gib: 40 } } },
        { id: 'org-b', workspaces: { b1: { gib: 40 } } },
      ],
    });
    expect(await run.run()).toMatchObject({ usage: 'read', freedBytes: 0 });
    expect(run.asked).toEqual(['org-a']);
    expect(run.retired).toEqual([]);
  });

  it('keeps the workspaces of an organization that switched disk reclaim off, and takes the others [SBX-R38]', async () => {
    const run = sweep({
      disk: disk(6),
      organizations: [
        {
          id: 'org-a',
          policy: { reclaimOnDiskPressure: false },
          workspaces: { a1: { gib: 30 } },
        },
        { id: 'org-b', workspaces: { b1: { gib: 9 }, b2: { gib: 8 } } },
      ],
    });
    await run.run();
    expect(run.asked).toEqual(['org-b']);
    expect(run.order()).toEqual(['b1 disk_pressure', 'b2 disk_pressure']);
  });

  it('asks nobody while no organization caps its workspaces or reclaims for the disk [SBX-R38]', async () => {
    const run = sweep({
      disk: disk(1),
      organizations: [
        {
          id: 'org-a',
          policy: { reclaimOnDiskPressure: false },
          workspaces: { a1: { gib: 30 } },
        },
      ],
    });
    expect(await run.run()).toMatchObject({ usage: 'skipped' });
    expect(run.asked).toEqual([]);
  });

  it("deletes every idle workspace above its organization's cap, largest first, whatever the disk holds [SBX-R37]", async () => {
    const run = sweep({
      disk: disk(500),
      organizations: [
        {
          id: 'org-a',
          policy: { maxWorkspaceGiB: 30, reclaimOnDiskPressure: false },
          workspaces: {
            a1: { gib: 34 },
            a2: { gib: 40 },
            a3: { gib: 30 },
            a4: { gib: 12 },
          },
        },
        { id: 'org-b', workspaces: { b1: { gib: 90 } } },
      ],
    });
    await run.run();
    expect(run.order()).toEqual(['a2 over_size', 'a1 over_size']);
    expect(run.retired[0]?.detail).toEqual({
      lastUsedAt: NOW - 48 * HOUR,
      workspaceBytes: 40 * GIB,
      measuredAtMs: ANSWERED - 5 * 60_000,
      maxWorkspaceGiB: 30,
    });
    // The capped organization said the disk has room: nobody else is asked.
    expect(run.asked).toEqual(['org-a']);
  });

  it('counts what the cap deleted toward the room the disk needs [SBX-R37] [SBX-R34]', async () => {
    const run = sweep({
      disk: disk(6),
      organizations: [
        { id: 'org-a', workspaces: { a1: { gib: 9 } } },
        {
          id: 'org-b',
          policy: { maxWorkspaceGiB: 20 },
          workspaces: { b1: { gib: 25 }, b2: { gib: 15 } },
        },
      ],
    });
    await run.run();
    // 6 + 25 GiB clears the 20 GiB target: nothing goes for the disk.
    expect(run.order()).toEqual(['b1 over_size']);
    expect(run.asked).toEqual(['org-b', 'org-a']);
  });

  it('never deletes a workspace whose size is unknown, or was measured before its last use [SBX-R36]', async () => {
    const run = sweep({
      disk: disk(1),
      organizations: [
        {
          id: 'org-a',
          policy: { maxWorkspaceGiB: 10 },
          workspaces: {
            unmeasured: { gib: null },
            never: { gib: 50, measuredAgoMs: null },
            before: { gib: 50, measuredAgoMs: 72 * HOUR },
            known: { gib: 5 },
          },
        },
      ],
    });
    const result = await run.run();
    expect(run.order()).toEqual(['known disk_pressure']);
    expect(result.unmeasured).toBe(3);
    expect(result.freedBytes).toBe(5 * GIB);
  });

  it('weighs no workspace a hold keeps, one the rows do not hold, or one not idle [SBX-R35]', async () => {
    const run = sweep({
      disk: disk(1),
      organizations: [
        {
          id: 'org-a',
          held: ['held'],
          workspaces: {
            held: { gib: 40 },
            rowless: { gib: 40, facts: null },
            pinned: { gib: 40, facts: idle({ pinned: true }) },
            running: { gib: 40, facts: idle({ inUse: true }) },
            recent: { gib: 40, facts: idle({ lastUsedAt: NOW - HOUR }) },
            spare: { gib: 4 },
          },
        },
      ],
    });
    await run.run();
    expect(run.order()).toEqual(['spare disk_pressure']);
  });

  it('reclaims nothing through a spawner older than the usage route', async () => {
    const run = sweep({
      disk: disk(1),
      organizations: [
        { id: 'org-a', workspaces: { a1: { gib: 40 } } },
        { id: 'org-b', workspaces: { b1: { gib: 40 } } },
      ],
      usage: async () => null,
    });
    expect(await run.run()).toMatchObject({ usage: 'unsupported' });
    expect(run.asked).toEqual(['org-a']);
    expect(run.retired).toEqual([]);
  });

  it("weighs the others when one organization's usage cannot be read", async () => {
    const run = sweep({
      disk: disk(1),
      organizations: [
        { id: 'org-a', workspaces: { a1: { gib: 40 } } },
        { id: 'org-b', workspaces: { b1: { gib: 30 } } },
      ],
      usage: async (organizationId) => {
        if (organizationId === 'org-a') {
          throw new Error('sandbox workspace usage unavailable (503)');
        }
        return {
          measuredAtMs: ANSWERED,
          disk: disk(1),
          workspaces: [
            {
              sessionId: 'b1',
              bytes: 30 * GIB,
              measuredAtMs: ANSWERED - 60_000,
            },
          ],
        };
      },
    });
    expect(await run.run()).toMatchObject({ usage: 'read' });
    expect(run.order()).toEqual(['b1 disk_pressure']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('the workspace usage of org-a is unavailable'),
      'sandbox workspace usage unavailable (503)',
    );
  });

  it('reads no disk where the spawner does not hold it, and deletes nothing for it', async () => {
    const run = sweep({
      disk: null,
      organizations: [{ id: 'org-a', workspaces: { a1: { gib: 40 } } }],
    });
    expect(await run.run()).toMatchObject({ usage: 'read', disk: null });
    expect(run.retired).toEqual([]);
  });

  it("stops at the sweep's bounds", async () => {
    const run = sweep({
      disk: disk(1),
      organizations: [
        { id: 'org-a', workspaces: { a1: { gib: 3 }, a2: { gib: 2 } } },
      ],
      bound: 1,
    });
    await run.run();
    expect(run.order()).toEqual(['a1 disk_pressure']);
  });
});
