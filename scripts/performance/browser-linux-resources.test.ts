import { describe, expect, test } from 'bun:test';

import {
  cleanupLinuxResources,
  containerResourceArgs,
  createResourcePlan,
  initializeLinuxResources,
  sampleLinuxResources,
  verifyContainerResources,
  type ResourceIO,
  type ResourceRole,
} from './browser/linux-resources';

function fixture() {
  const plan = createResourcePlan(
    '/tmp/synthetic-browser-evidence',
    'a'.repeat(32),
  );
  const files = new Map<string, string>();
  const calls: { command: string; args: readonly string[]; timeout: number }[] =
    [];
  const records = new Map<
    string,
    {
      Id: string;
      State: { Pid: number; Running: boolean };
      HostConfig: { CgroupParent: string };
      Config: { Labels: Record<string, string> };
    }
  >();
  const info = {
    OSType: 'linux',
    Architecture: 'x86_64',
    CgroupDriver: 'systemd',
    CgroupVersion: '2',
  };
  let failStop = false;
  let stopThrowsAfterEffect = false;
  let failRemove = false;
  let removeThrowsAfterEffect = false;
  let unreadablePath: string | undefined;
  let failedWritePath: string | undefined;
  const io: ResourceIO = {
    host: { platform: 'linux', arch: 'x64' },
    async readFile(path) {
      if (path === unreadablePath)
        throw new Error('synthetic unreadable evidence');
      return files.get(path);
    },
    async writeExclusive(path, contents) {
      if (files.has(path) || path === failedWritePath)
        throw new Error('exclusive creation failed');
      files.set(path, contents);
    },
    async removeFile(path) {
      files.delete(path);
    },
    async command(command, args, timeout) {
      calls.push({ command, args, timeout });
      if (command === 'docker' && args[0] === 'info') {
        return { code: 0, stdout: JSON.stringify(info), stderr: '' };
      }
      if (command === 'docker' && args[0] === 'container') {
        const id = args.at(-1)!;
        const record = records.get(id);
        return record
          ? { code: 0, stdout: JSON.stringify(record), stderr: '' }
          : { code: 1, stdout: '', stderr: `Error: No such container: ${id}` };
      }
      if (command === 'docker' && args[0] === 'stop') {
        const id = args.at(-1)!;
        if (!failStop) {
          const record = records.get(id);
          if (record) record.State.Running = false;
          if (![...records.values()].some((entry) => entry.State.Running)) {
            files.set(
              `${plan.groupPath}/cgroup.events`,
              'populated 0\nfrozen 0\n',
            );
          }
        }
        if (stopThrowsAfterEffect) throw new Error('synthetic stop deadline');
        return { code: failStop ? null : 0, stdout: '', stderr: '' };
      }
      if (command === 'docker' && args[0] === 'rm') {
        const id = args.at(-1)!;
        if (!failRemove) records.delete(id);
        if (removeThrowsAfterEffect)
          throw new Error('synthetic remove deadline');
        return { code: failRemove ? null : 0, stdout: '', stderr: '' };
      }
      if (command === 'sudo' && args[2] === 'show') {
        return { code: 0, stdout: `/${plan.slice}\n`, stderr: '' };
      }
      if (command === 'sudo' && args[2] === 'stop') {
        for (const path of files.keys()) {
          if (path.startsWith(`${plan.groupPath}/`)) files.delete(path);
        }
      }
      if (command === 'sudo' && args[2] === 'start') {
        files.set(`${plan.groupPath}/cpu.max`, '200000 100000\n');
        files.set(`${plan.groupPath}/memory.max`, '4294967296\n');
        files.set(`${plan.groupPath}/cgroup.events`, 'populated 0\nfrozen 0\n');
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  function add(role: ResourceRole) {
    const id = (role === 'db' ? 'b' : 'c').repeat(64);
    const pid = role === 'db' ? 101 : 102;
    const record = {
      Id: id,
      State: { Pid: pid, Running: true },
      HostConfig: { CgroupParent: plan.slice },
      Config: { Labels: { 'dev.tale.browser-performance.owner': plan.token } },
    };
    records.set(id, record);
    files.set(plan.cidPaths[role], id);
    files.set(`/proc/${pid}/cgroup`, `0::/${plan.slice}/docker-${id}.scope\n`);
    files.set(`${plan.groupPath}/cgroup.events`, 'populated 1\nfrozen 0\n');
    return record;
  }
  return {
    io,
    plan,
    files,
    calls,
    records,
    info,
    add,
    failStop: () => {
      failStop = true;
    },
    stopThrowsAfterEffect: () => {
      stopThrowsAfterEffect = true;
    },
    failRemove: () => {
      failRemove = true;
    },
    removeThrowsAfterEffect: () => {
      removeThrowsAfterEffect = true;
    },
    unreadable: (path: string) => {
      unreadablePath = path;
    },
    failWrite: (path: string) => {
      failedWritePath = path;
    },
  };
}

describe('shared browser diagnostic resource boundary', () => {
  test('both containers use the same verified aggregate budget and distinct CID receipts', async () => {
    const f = fixture();
    expect(await initializeLinuxResources(f.io, f.plan)).toEqual({
      OSType: 'linux',
      Architecture: 'x86_64',
      CgroupDriver: 'systemd',
      CgroupVersion: '2',
      cgroupLimits: {
        'cpu.max': '200000 100000\n',
        'memory.max': '4294967296\n',
      },
    });
    const db = f.add('db');
    const browser = f.add('browser');
    expect(await verifyContainerResources(f.io, f.plan, 'db')).toEqual({
      id: db.Id,
      pid: 101,
      cgroup: `/${f.plan.slice}/docker-${db.Id}.scope`,
    });
    expect((await verifyContainerResources(f.io, f.plan, 'browser')).pid).toBe(
      browser.State.Pid,
    );
    expect(containerResourceArgs(f.plan, 'db')).toContain(f.plan.cidPaths.db);
    expect(containerResourceArgs(f.plan, 'browser')).toContain(
      f.plan.cidPaths.browser,
    );
    expect(containerResourceArgs(f.plan, 'db')).toContain(f.plan.slice);
    expect(containerResourceArgs(f.plan, 'browser')).toContain(f.plan.slice);
    expect(
      f.calls.every((call) => call.timeout > 0 && call.timeout <= 17_000),
    ).toBe(true);
  });

  test.each(['darwin', 'win32'])(
    'refuses %s without a side effect',
    async (platform) => {
      const f = fixture();
      f.io.host.platform = platform;
      await expect(initializeLinuxResources(f.io, f.plan)).rejects.toThrow(
        'native Linux',
      );
      expect(f.calls).toHaveLength(0);
      expect(f.files.size).toBe(0);
    },
  );

  test.each(['CgroupDriver', 'CgroupVersion', 'Architecture'] as const)(
    'refuses incompatible Docker %s',
    async (field) => {
      const f = fixture();
      f.info[field] = 'unsupported';
      await expect(initializeLinuxResources(f.io, f.plan)).rejects.toThrow();
      expect(f.files.size).toBe(0);
    },
  );

  test('rejects unsafe identity and relative evidence paths', () => {
    expect(() => createResourcePlan('/tmp/evidence', '../foreign')).toThrow();
    expect(() => createResourcePlan('./evidence', 'a'.repeat(32))).toThrow();
  });

  test('an existing unit is never replaced or claimed', async () => {
    const f = fixture();
    f.files.set(f.plan.unitPath, 'foreign unit');
    await expect(initializeLinuxResources(f.io, f.plan)).rejects.toThrow(
      'exclusive',
    );
    expect(f.files.get(f.plan.unitPath)).toBe('foreign unit');
    expect(f.files.has(f.plan.ownershipPath)).toBe(false);
    const cleanup = await cleanupLinuxResources(f.io, f.plan);
    expect(cleanup.ok).toBe(false);
    expect(f.files.get(f.plan.unitPath)).toBe('foreign unit');
    expect(f.calls.some((call) => call.args.includes('stop'))).toBe(false);
  });

  test('failed durable ownership recording removes only the just-created idle unit', async () => {
    const f = fixture();
    f.failWrite(f.plan.ownershipPath);
    await expect(initializeLinuxResources(f.io, f.plan)).rejects.toThrow(
      'exclusive',
    );
    expect(f.files.has(f.plan.unitPath)).toBe(false);
    expect(f.calls.some((call) => call.args.includes('start'))).toBe(false);
  });

  test.each([
    ['cpu.max', 'max 100000'],
    ['memory.max', 'max'],
  ])(
    'declared settings do not substitute for actual %s enforcement',
    async (name, value) => {
      const f = fixture();
      await initializeLinuxResources(f.io, f.plan);
      f.add('db');
      f.files.set(`${f.plan.groupPath}/${name}`, value);
      await expect(
        verifyContainerResources(f.io, f.plan, 'db'),
      ).rejects.toThrow();
    },
  );

  test('a matching Docker parent setting does not hide a PID outside the slice', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    f.add('db');
    f.files.set('/proc/101/cgroup', '0::/system.slice/unrelated.scope\n');
    await expect(verifyContainerResources(f.io, f.plan, 'db')).rejects.toThrow(
      'escaped',
    );
  });

  test('foreign ownership is refused by verification and cleanup', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    const foreign = f.add('db');
    foreign.Config.Labels['dev.tale.browser-performance.owner'] = 'foreign';
    await expect(verifyContainerResources(f.io, f.plan, 'db')).rejects.toThrow(
      'another diagnostic',
    );
    const cleanup = await cleanupLinuxResources(f.io, f.plan);
    expect(cleanup.ok).toBe(false);
    expect(cleanup.slice).toBe('retained');
    expect(f.calls.some((call) => call.args[0] === 'stop')).toBe(false);
    expect(f.calls.some((call) => call.args[0] === 'rm')).toBe(false);
  });

  test.each(['', 'partial', 'd'.repeat(63)])(
    'invalid CID %j cannot skip cleanup of its valid sibling',
    async (invalid) => {
      const f = fixture();
      await initializeLinuxResources(f.io, f.plan);
      const browser = f.add('browser');
      f.files.set(f.plan.cidPaths.db, invalid);
      const cleanup = await cleanupLinuxResources(f.io, f.plan);
      expect(cleanup.ok).toBe(false);
      expect(browser.State.Running).toBe(false);
      expect(cleanup.containers.browser).toBe('removed');
      expect(cleanup.slice).toBe('retained');
    },
  );

  test('an unreadable CID still allows sibling cleanup', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    f.unreadable(f.plan.cidPaths.db);
    const browser = f.add('browser');
    expect((await cleanupLinuxResources(f.io, f.plan)).ok).toBe(false);
    expect(browser.State.Running).toBe(false);
  });

  test('a stop timeout cannot be reported successful while the container is running', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    f.add('db');
    f.failStop();
    const cleanup = await cleanupLinuxResources(f.io, f.plan);
    expect(cleanup.ok).toBe(false);
    expect(cleanup.errors.join(' ')).toContain('remains running');
    expect(cleanup.slice).toBe('retained');
    expect(f.files.has(f.plan.unitPath)).toBe(true);
    expect(f.calls.some((call) => call.args[0] === 'rm')).toBe(false);
  });

  test('a stop that timed out after taking effect is judged by readback', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    f.add('db');
    f.stopThrowsAfterEffect();
    expect((await cleanupLinuxResources(f.io, f.plan)).ok).toBe(true);
  });

  test('an exited container is removed by exact ID without force and verified absent', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    const db = f.add('db');
    db.State.Running = false;
    f.files.set(`${f.plan.groupPath}/cgroup.events`, 'populated 0\n');
    const cleanup = await cleanupLinuxResources(f.io, f.plan);
    expect(cleanup.ok).toBe(true);
    expect(cleanup.containers.db).toBe('removed');
    expect(f.records.has(db.Id)).toBe(false);
    expect(f.calls.find((call) => call.args[0] === 'rm')?.args).toEqual([
      'rm',
      '--volumes',
      db.Id,
    ]);
    expect(f.calls.some((call) => call.args[0] === 'stop')).toBe(false);
  });

  test('a failed removal retains the slice and does not claim cleanup success', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    const db = f.add('db');
    f.failRemove();
    const cleanup = await cleanupLinuxResources(f.io, f.plan);
    expect(cleanup.ok).toBe(false);
    expect(cleanup.errors.join(' ')).toContain('remains after removal');
    expect(cleanup.slice).toBe('retained');
    expect(f.records.has(db.Id)).toBe(true);
  });

  test('a removal deadline after taking effect is judged by absent readback', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    f.add('db');
    f.removeThrowsAfterEffect();
    expect((await cleanupLinuxResources(f.io, f.plan)).ok).toBe(true);
  });

  test('a populated slice with missing CID evidence is not stopped', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    f.files.set(`${f.plan.groupPath}/cgroup.events`, 'populated 1\n');
    const cleanup = await cleanupLinuxResources(f.io, f.plan);
    expect(cleanup.ok).toBe(false);
    expect(
      f.calls.some(
        (call) => call.command === 'sudo' && call.args[2] === 'stop',
      ),
    ).toBe(false);
  });

  test.each(['populated 0\npopulated 1\n', 'frozen 0\n'])(
    'malformed population counters %j cannot certify an empty slice',
    async (events) => {
      const f = fixture();
      await initializeLinuxResources(f.io, f.plan);
      f.files.set(`${f.plan.groupPath}/cgroup.events`, events);
      expect((await cleanupLinuxResources(f.io, f.plan)).ok).toBe(false);
      expect(f.files.has(f.plan.unitPath)).toBe(true);
    },
  );

  test('missing unit and ownership files do not hide a populated cgroup', async () => {
    const f = fixture();
    f.files.set(`${f.plan.groupPath}/cgroup.events`, 'populated 1\n');
    expect((await cleanupLinuxResources(f.io, f.plan)).ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  test('a missing unit does not certify an empty but still present slice as absent', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    f.files.delete(f.plan.unitPath);
    const cleanup = await cleanupLinuxResources(f.io, f.plan);
    expect(cleanup.ok).toBe(false);
    expect(cleanup.slice).toBe('retained');
    expect(cleanup.errors.join(' ')).toContain('cgroup remains');
    expect(f.calls.some((call) => call.args.includes('stop'))).toBe(false);
  });

  test('cleanup is idempotent and never uses container names, recursive removal or pruning', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    f.add('db');
    f.add('browser');
    expect((await cleanupLinuxResources(f.io, f.plan)).ok).toBe(true);
    expect((await cleanupLinuxResources(f.io, f.plan)).ok).toBe(true);
    expect(f.files.has(f.plan.unitPath)).toBe(false);
    expect(
      f.calls.filter(
        (call) => call.command === 'docker' && call.args[0] === 'stop',
      ),
    ).toHaveLength(2);
    expect(
      f.calls.some(
        (call) => call.args.includes('prune') || call.args.includes('--force'),
      ),
    ).toBe(false);
    expect(f.calls.filter((call) => call.args[0] === 'rm')).toHaveLength(2);
  });

  test('a modified unit is preserved after owned containers stop', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    const db = f.add('db');
    f.files.set(f.plan.unitPath, 'changed by another owner');
    const cleanup = await cleanupLinuxResources(f.io, f.plan);
    expect(cleanup.ok).toBe(false);
    expect(db.State.Running).toBe(false);
    expect(f.files.get(f.plan.unitPath)).toBe('changed by another owner');
  });

  test('retains raw counters and refuses a missing counter instead of inventing zero', async () => {
    const f = fixture();
    await initializeLinuxResources(f.io, f.plan);
    for (const name of [
      'cpu.stat',
      'cpu.pressure',
      'memory.current',
      'memory.peak',
      'memory.events',
      'memory.pressure',
    ]) {
      f.files.set(`${f.plan.groupPath}/${name}`, `synthetic ${name}\n`);
    }
    expect((await sampleLinuxResources(f.io, f.plan))['cpu.stat']).toBe(
      'synthetic cpu.stat\n',
    );
    f.files.delete(`${f.plan.groupPath}/cpu.pressure`);
    await expect(sampleLinuxResources(f.io, f.plan)).rejects.toThrow(
      'Missing resource counter',
    );
  });
});
