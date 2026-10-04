import assert from 'node:assert/strict';
import { isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

export interface ResourceIO {
  host: { platform: string; arch: string };
  /** Must enforce the deadline, terminating its own timed-out process tree. */
  command(
    command: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
  /** Only ENOENT maps to undefined; permission/transport errors must throw. */
  readFile(path: string): Promise<string | undefined>;
  /** Atomic exclusive creation. Unit files need the adapter's narrow privilege. */
  writeExclusive(path: string, contents: string): Promise<void>;
  /** Idempotent for ENOENT only; never recursive. */
  removeFile(path: string): Promise<void>;
}

export type ResourceRole = 'db' | 'browser';
const roles: ResourceRole[] = ['db', 'browser'];
const ownerLabel = 'dev.tale.browser-performance.owner';
const commandTimeout = 15_000;
const containerId = /^[a-f0-9]{64}$/;
const memoryBytes = '4294967296';

/** The caller owns a newly created private evidence directory. Persist the
 * directory and token before setup so an always-step can reconstruct this plan. */
export function createResourcePlan(directory: string, token: string) {
  assert(isAbsolute(directory) && !/[\r\n\0]/.test(directory));
  assert.match(token, /^[a-f0-9]{32}$/);
  const evidenceDir = resolve(directory);
  const slice = `talebench${token}.slice`;
  return {
    token,
    slice,
    unitPath: `/run/systemd/system/${slice}`,
    groupPath: `/sys/fs/cgroup/${slice}`,
    ownershipPath: join(evidenceDir, 'slice-owned'),
    cidPaths: {
      db: join(evidenceDir, 'db.cid'),
      browser: join(evidenceDir, 'browser.cid'),
    },
  };
}

export type ResourcePlan = ReturnType<typeof createResourcePlan>;

function unitContents(plan: ResourcePlan) {
  return `# Owned browser diagnostic ${plan.token}\n[Unit]\nDescription=Tale browser diagnostic ${plan.token}\n[Slice]\nCPUAccounting=yes\nMemoryAccounting=yes\nCPUQuota=200%\nCPUQuotaPeriodSec=100ms\nMemoryMax=${memoryBytes}\n`;
}

async function checked(
  io: ResourceIO,
  command: string,
  args: readonly string[],
  timeout = commandTimeout,
) {
  const result = await io.command(command, args, timeout);
  assert.equal(result.code, 0, `${command} resource operation failed`);
  return result.stdout.trim();
}

async function systemctl(io: ResourceIO, args: readonly string[]) {
  return checked(io, 'sudo', ['-n', 'systemctl', ...args]);
}

async function verifySlice(io: ResourceIO, plan: ResourcePlan) {
  const group = await systemctl(io, [
    'show',
    '--property=ControlGroup',
    '--value',
    plan.slice,
  ]);
  assert.equal(group, `/${plan.slice}`, 'Unexpected diagnostic cgroup path');
  const cpuMax = await io.readFile(`${plan.groupPath}/cpu.max`);
  const memoryMax = await io.readFile(`${plan.groupPath}/memory.max`);
  assert.equal(
    cpuMax?.trim().replace(/\s+/g, ' '),
    '200000 100000',
    'Shared CPU quota was not applied',
  );
  assert.equal(
    memoryMax?.trim(),
    memoryBytes,
    'Shared memory ceiling was not applied',
  );
  return { 'cpu.max': cpuMax, 'memory.max': memoryMax };
}

export async function initializeLinuxResources(
  io: ResourceIO,
  plan: ResourcePlan,
) {
  assert.equal(io.host.platform, 'linux', 'Diagnostic requires native Linux');
  assert.equal(io.host.arch, 'x64', 'Diagnostic requires native amd64');
  const info = z
    .object({
      OSType: z.literal('linux'),
      Architecture: z.enum(['x86_64', 'amd64']),
      CgroupDriver: z.literal('systemd'),
      CgroupVersion: z.literal('2'),
    })
    .parse(
      JSON.parse(
        await checked(io, 'docker', ['info', '--format', '{{json .}}']),
      ),
    );
  for (const path of [plan.ownershipPath, ...Object.values(plan.cidPaths)]) {
    assert.equal(
      await io.readFile(path),
      undefined,
      'Resource evidence already exists',
    );
  }
  // Never overwrite a unit, even if a colliding name contains identical bytes.
  await io.writeExclusive(plan.unitPath, unitContents(plan));
  try {
    await io.writeExclusive(plan.ownershipPath, plan.token);
  } catch (error) {
    // No process has entered the slice yet. Undo only our exclusive creation.
    assert.equal(await io.readFile(plan.unitPath), unitContents(plan));
    await io.removeFile(plan.unitPath);
    throw error;
  }
  await systemctl(io, ['daemon-reload']);
  await systemctl(io, ['start', plan.slice]);
  const cgroupLimits = await verifySlice(io, plan);
  return { ...info, cgroupLimits };
}

export function containerResourceArgs(plan: ResourcePlan, role: ResourceRole) {
  return [
    '--cidfile',
    plan.cidPaths[role],
    '--cgroup-parent',
    plan.slice,
    '--label',
    `${ownerLabel}=${plan.token}`,
  ];
}

const inspectionSchema = z.object({
  Id: z.string().regex(containerId),
  State: z.object({
    Pid: z.number().int().nonnegative(),
    Running: z.boolean(),
  }),
  HostConfig: z.object({ CgroupParent: z.string() }),
  Config: z.object({ Labels: z.record(z.string(), z.string()).nullable() }),
});

async function inspect(io: ResourceIO, id: string) {
  assert.match(id, containerId, 'Invalid owned container ID');
  const reply = await io.command(
    'docker',
    ['container', 'inspect', '--format', '{{json .}}', id],
    commandTimeout,
  );
  if (reply.code === 1 && /No such (object|container)/i.test(reply.stderr))
    return null;
  assert.equal(reply.code, 0, 'Container ownership inspection failed');
  const record = inspectionSchema.parse(JSON.parse(reply.stdout));
  assert.equal(record.Id, id, 'Docker returned another container');
  return record;
}

function assertOwned(
  record: z.infer<typeof inspectionSchema>,
  plan: ResourcePlan,
) {
  assert.equal(
    record.Config.Labels?.[ownerLabel],
    plan.token,
    'Container belongs to another diagnostic',
  );
  assert.equal(
    record.HostConfig.CgroupParent,
    plan.slice,
    'Container has another cgroup parent',
  );
}

export async function verifyContainerResources(
  io: ResourceIO,
  plan: ResourcePlan,
  role: ResourceRole,
) {
  await verifySlice(io, plan);
  const id = (await io.readFile(plan.cidPaths[role]))?.trim();
  assert(
    id && containerId.test(id),
    `Missing or invalid ${role} ownership receipt`,
  );
  const record = await inspect(io, id);
  assert(record, 'Owned container disappeared');
  assertOwned(record, plan);
  assert(
    record.State.Running && record.State.Pid > 0,
    'Owned container is not running',
  );
  const membership = await io.readFile(`/proc/${record.State.Pid}/cgroup`);
  const groups = membership?.trim().split('\n');
  assert.equal(groups?.length, 1, 'Expected one unified cgroup membership');
  assert(
    groups?.[0]?.startsWith(`0::/${plan.slice}/`),
    'Container PID escaped the shared slice',
  );
  return { id, pid: record.State.Pid, cgroup: groups[0].slice(3) };
}

export async function sampleLinuxResources(io: ResourceIO, plan: ResourcePlan) {
  await verifySlice(io, plan);
  const values: Record<string, string> = {};
  for (const name of [
    'cpu.stat',
    'cpu.pressure',
    'memory.current',
    'memory.peak',
    'memory.events',
    'memory.pressure',
    'cgroup.events',
  ]) {
    const value = await io.readFile(`${plan.groupPath}/${name}`);
    assert(value !== undefined, `Missing resource counter ${name}`);
    values[name] = value;
  }
  return values;
}

export interface ResourceCleanup {
  ok: boolean;
  errors: string[];
  containers: Partial<
    Record<ResourceRole, 'absent' | 'removed' | 'no-receipt'>
  >;
  slice: 'removed' | 'absent' | 'retained';
}

async function assertUnpopulated(io: ResourceIO, plan: ResourcePlan) {
  const events = await io.readFile(`${plan.groupPath}/cgroup.events`);
  if (events === undefined) return;
  const populated = events
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('populated '));
  assert.deepEqual(populated, ['populated 0'], 'Slice is not known empty');
}

/** Persist this receipt even on failure, then fail the phase when !ok. Never
 * stop a slice to clean up a container whose identity could not be established. */
export async function cleanupLinuxResources(
  io: ResourceIO,
  plan: ResourcePlan,
): Promise<ResourceCleanup> {
  const result: ResourceCleanup = {
    ok: false,
    errors: [],
    containers: {},
    slice: 'retained',
  };
  for (const role of roles) {
    try {
      const raw = await io.readFile(plan.cidPaths[role]);
      if (raw === undefined) {
        result.containers[role] = 'no-receipt';
        continue;
      }
      const id = raw.trim();
      assert.match(id, containerId, `Invalid ${role} ownership receipt`);
      const before = await inspect(io, id);
      if (before) {
        assertOwned(before, plan);
        if (before.State.Running) {
          // Even a timed-out/failed stop can have taken effect: read back before judging.
          await io
            .command('docker', ['stop', '--time', '10', id], 17_000)
            .catch(() => undefined);
        }
      }
      const after = await inspect(io, id);
      if (after) {
        assertOwned(after, plan);
        assert(
          !after.State.Running,
          'Owned container remains running after stop',
        );
        // No force: a concurrently restarted container must refuse removal.
        // The caller collects logs before cleanup; only anonymous volumes go.
        await io
          .command('docker', ['rm', '--volumes', id], commandTimeout)
          .catch(() => undefined);
        assert.equal(
          await inspect(io, id),
          null,
          'Owned container remains after removal',
        );
      }
      result.containers[role] = after ? 'removed' : 'absent';
    } catch (error) {
      result.errors.push(
        `${role}: ${error instanceof Error ? error.message : 'cleanup failed'}`,
      );
    }
  }
  try {
    const marker = await io.readFile(plan.ownershipPath);
    const contents = await io.readFile(plan.unitPath);
    if (contents === undefined) {
      // Missing unit text alone does not prove a previously started slice stopped.
      if (marker !== undefined) {
        assert.equal(marker, plan.token, 'Invalid slice ownership receipt');
      }
      assert.equal(
        await io.readFile(`${plan.groupPath}/cgroup.events`),
        undefined,
        'Slice cgroup remains without its owned unit file',
      );
      result.slice = 'absent';
    } else {
      assert.equal(
        marker,
        plan.token,
        'Missing or invalid slice ownership receipt',
      );
      assert.equal(
        contents,
        unitContents(plan),
        'Slice unit was changed or is not owned',
      );
      assert.equal(
        result.errors.length,
        0,
        'Container uncertainty keeps the slice intact',
      );
      await assertUnpopulated(io, plan);
      await systemctl(io, ['stop', plan.slice]);
      await assertUnpopulated(io, plan);
      await io.removeFile(plan.unitPath);
      await systemctl(io, ['daemon-reload']);
      result.slice = 'removed';
    }
  } catch (error) {
    result.errors.push(
      `slice: ${error instanceof Error ? error.message : 'cleanup failed'}`,
    );
  }
  result.ok = result.errors.length === 0;
  return result;
}
