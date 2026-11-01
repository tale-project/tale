import { describe, expect, test } from 'bun:test';

import {
  agentSessionMemoryBytes,
  autoSessionCapacity,
  dockerMemoryBytes,
  HostMemoryProbe,
  hostSessionCapacity,
  memoryReserveBytes,
  sessionWorkingSetBytes,
} from './host-memory.ts';
import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';
import type { SessionConfig, SpawnerConfig } from './types.ts';

const GIB = 1024 ** 3;

describe('sizing from the host', () => {
  test.each([16, 17])(
    'rejects an impossible %s GiB reserve at boot sizing',
    (reserve) => {
      expect(() => autoSessionCapacity(16 * GIB, reserve * GIB)).toThrow(
        'SANDBOX_MIN_FREE_MEMORY',
      );
    },
  );
  test('the reserve is a tenth of the host, at least 1 GiB, unless configured', () => {
    expect(memoryReserveBytes(4 * GIB)).toBe(GIB);
    expect(memoryReserveBytes(64 * GIB)).toBe(Math.floor((64 * GIB) / 10));
    expect(memoryReserveBytes(64 * GIB, 2 * GIB)).toBe(2 * GIB);
  });

  test('capacity follows memory, never below the old default of 8 nor above 256', () => {
    const capacity = (gib: number) =>
      autoSessionCapacity(gib * GIB, memoryReserveBytes(gib * GIB));
    expect(capacity(4)).toBe(8);
    expect(capacity(16)).toBe(19);
    expect(capacity(64)).toBe(76);
    expect(capacity(1024)).toBe(256);
  });

  test('where agent sessions run their own Docker daemon, a slot holds a whole such turn', () => {
    const capacity = (gib: number) =>
      autoSessionCapacity(gib * GIB, memoryReserveBytes(gib * GIB), true);
    expect(capacity(4)).toBe(8);
    expect(capacity(16)).toBe(9);
    expect(capacity(64)).toBe(38);
  });

  test('capacity is at most two sessions per CPU the daemon reports, still never below 8', () => {
    const capacity = (gib: number, cpus: number | null) =>
      autoSessionCapacity(
        gib * GIB,
        memoryReserveBytes(gib * GIB),
        false,
        undefined,
        cpus,
      );
    // 16 GiB fits 19 sessions by memory; 4 CPUs take 8 of them.
    expect(capacity(16, 4)).toBe(8);
    expect(capacity(64, 16)).toBe(32);
    expect(capacity(64, 2)).toBe(8);
    // Memory still binds where CPUs are plenty, and unknown CPUs leave it alone.
    expect(capacity(16, 64)).toBe(19);
    expect(capacity(16, null)).toBe(19);
    expect(capacity(1024, 256)).toBe(256);
  });

  test('disabling Docker for every workload sizes light sessions while allowing any workload retains the Docker budget', () => {
    const reserve = memoryReserveBytes(16 * GIB);
    expect(autoSessionCapacity(16 * GIB, reserve, true, [])).toBe(19);
    expect(autoSessionCapacity(16 * GIB, reserve, true, ['project'])).toBe(9);
    expect(autoSessionCapacity(16 * GIB, reserve, true)).toBe(9);
  });

  test('a starting session is planned at its kind of working set', () => {
    expect(sessionWorkingSetBytes('default', true)).toBe(512 * 1024 ** 2);
    expect(sessionWorkingSetBytes('agent', false)).toBe(512 * 1024 ** 2);
    expect(sessionWorkingSetBytes('agent', true)).toBe(1536 * 1024 ** 2);
  });
});

describe('the session capacity against the host memory', () => {
  /** #3977's host: 4 vCPUs and 15.6 GiB, so a reserve of 1.56 GiB. */
  const HOST = Math.round(15.6 * GIB);
  const capacityConfig = (
    session: Partial<SessionConfig> = {},
    memory: { memory?: string; memoryWithoutDocker?: string } = {},
    rest: Partial<
      Pick<
        SpawnerConfig,
        'dockerInContainer' | 'dockerWorkloads' | 'deviceConfigPath'
      >
    > = {},
  ) => ({
    session: {
      ...TEST_SESSION_CONFIG,
      ...session,
      agentProfile: { ...TEST_SESSION_CONFIG.agentProfile, ...memory },
    },
    dockerInContainer: false,
    deviceConfigPath: null,
    ...rest,
  });

  test('reads the Docker memory sizes a session limit takes', () => {
    expect(dockerMemoryBytes('4g')).toBe(4 * GIB);
    expect(dockerMemoryBytes(' 8G ')).toBe(8 * GIB);
    expect(dockerMemoryBytes('1536m')).toBe(1.5 * GIB);
    expect(dockerMemoryBytes('4294967296')).toBe(4 * GIB);
    expect(dockerMemoryBytes('lots')).toBeNull();
    expect(dockerMemoryBytes('4gb')).toBeNull();
  });

  test("an agent session's memory is the largest limit one gets", () => {
    const docker = { memory: '8g', memoryWithoutDocker: '4g' };
    expect(agentSessionMemoryBytes(capacityConfig())).toBe(4 * GIB);
    expect(
      agentSessionMemoryBytes(
        capacityConfig({}, docker, { dockerInContainer: true }),
      ),
    ).toBe(8 * GIB);
    expect(
      agentSessionMemoryBytes(
        capacityConfig({}, docker, {
          dockerInContainer: true,
          dockerWorkloads: ['workflow'],
        }),
      ),
    ).toBe(8 * GIB);
    // No workload may run Docker: every agent session gets the limit without.
    expect(
      agentSessionMemoryBytes(
        capacityConfig({}, docker, {
          dockerInContainer: true,
          dockerWorkloads: [],
        }),
      ),
    ).toBe(4 * GIB);
    // SANDBOX_AGENT_MEMORY sets both.
    expect(
      agentSessionMemoryBytes(
        capacityConfig(
          {},
          { memory: '6g', memoryWithoutDocker: '6g' },
          { dockerInContainer: true },
        ),
      ),
    ).toBe(6 * GIB);
    expect(
      agentSessionMemoryBytes(capacityConfig({}, { memory: 'lots' })),
    ).toBeNull();
  });

  test('an explicit capacity that the host cannot hold at the session limit warns and stays', () => {
    expect(
      hostSessionCapacity(
        capacityConfig({ maxSessions: 8, autoMaxSessions: false }),
        HOST,
        4,
      ),
    ).toEqual({
      maxSessions: 8,
      sized: false,
      warning:
        '[sandbox] 8 sessions (SANDBOX_MAX_SESSIONS) of up to 4 GiB each (SANDBOX_AGENT_MEMORY) can use 32 GiB, more than the 14 GiB the host has for them: 15.6 GiB less its 1.6 GiB reserve (SANDBOX_MIN_FREE_MEMORY). With SANDBOX_MAX_SESSIONS set, memory admission is off, so sessions working at once can run the host out of memory: lower SANDBOX_MAX_SESSIONS or SANDBOX_AGENT_MEMORY, or unset SANDBOX_MAX_SESSIONS to size the capacity from the host and hold starts while its memory is short.',
    });
  });

  test('a capacity sized from the host warns as well, and says what admission still does', () => {
    expect(
      hostSessionCapacity(capacityConfig({ autoMaxSessions: true }), HOST, 4),
    ).toEqual({
      maxSessions: 8,
      sized: true,
      warning:
        "[sandbox] 8 sessions (sized from the host) of up to 4 GiB each (SANDBOX_AGENT_MEMORY) can use 32 GiB, more than the 14 GiB the host has for them: 15.6 GiB less its 1.6 GiB reserve (SANDBOX_MIN_FREE_MEMORY). A start waits while the host's memory is short, but running sessions can still grow to their limits together: set SANDBOX_MAX_SESSIONS or SANDBOX_AGENT_MEMORY lower if many work at once.",
    });
    // With Docker inside, the same 8 sessions may each use 8 GiB.
    expect(
      hostSessionCapacity(
        capacityConfig(
          { autoMaxSessions: true },
          { memory: '8g', memoryWithoutDocker: '4g' },
          { dockerInContainer: true },
        ),
        HOST,
        4,
      ).warning,
    ).toStartWith(
      '[sandbox] 8 sessions (sized from the host) of up to 8 GiB each (SANDBOX_AGENT_MEMORY) can use 64 GiB,',
    );
  });

  test('sessions that fit at their limit give no warning, up to exactly what the host has for them', () => {
    expect(
      hostSessionCapacity(
        capacityConfig({ maxSessions: 3, autoMaxSessions: false }),
        HOST,
        4,
      ),
    ).toEqual({ maxSessions: 3, sized: false, warning: null });
    // 3 × 4 GiB against 16 GiB less a 4 GiB reserve.
    expect(
      hostSessionCapacity(
        capacityConfig({
          maxSessions: 3,
          autoMaxSessions: false,
          minFreeMemoryBytes: 4 * GIB,
        }),
        16 * GIB,
        4,
      ).warning,
    ).toBeNull();
    // A large host whose four CPUs cap the sized capacity at 8.
    expect(
      hostSessionCapacity(
        capacityConfig({ autoMaxSessions: true }),
        64 * GIB,
        4,
      ),
    ).toEqual({ maxSessions: 8, sized: true, warning: null });
  });

  test('an impossible reserve still fails sizing, and only warns beside an explicit capacity', () => {
    const reserve = { minFreeMemoryBytes: 20 * GIB };
    expect(() =>
      hostSessionCapacity(
        capacityConfig({ ...reserve, autoMaxSessions: true }),
        16 * GIB,
        4,
      ),
    ).toThrow('SANDBOX_MIN_FREE_MEMORY');
    expect(
      hostSessionCapacity(
        capacityConfig({ ...reserve, maxSessions: 2, autoMaxSessions: false }),
        16 * GIB,
        4,
      ).warning,
    ).toStartWith(
      '[sandbox] 2 sessions (SANDBOX_MAX_SESSIONS) of up to 4 GiB each (SANDBOX_AGENT_MEMORY) can use 8 GiB, more than the 0 GiB the host has for them: 16 GiB less its 20 GiB reserve',
    );
  });

  test('a single session is named as one', () => {
    expect(
      hostSessionCapacity(
        capacityConfig(
          { maxSessions: 1, autoMaxSessions: false },
          { memory: '8g' },
        ),
        4 * GIB,
        2,
      ).warning,
    ).toStartWith(
      '[sandbox] 1 session (SANDBOX_MAX_SESSIONS) of up to 8 GiB each (SANDBOX_AGENT_MEMORY) can use 8 GiB, more than the 3 GiB the host has for them: 4 GiB less its 1 GiB reserve',
    );
  });

  test("a device's spawner and an unreadable session limit never warn", () => {
    expect(
      hostSessionCapacity(
        capacityConfig(
          { maxSessions: 4, autoMaxSessions: false },
          {},
          { deviceConfigPath: '/etc/tale/device.json' },
        ),
        HOST,
        4,
      ),
    ).toEqual({ maxSessions: 4, sized: false, warning: null });
    expect(
      hostSessionCapacity(
        capacityConfig(
          { maxSessions: 8, autoMaxSessions: false },
          { memory: 'lots' },
        ),
        HOST,
        4,
      ).warning,
    ).toBeNull();
  });
});

describe('HostMemoryProbe', () => {
  const meminfo = (totalKb: number, availableKb: number) =>
    `MemTotal:       ${totalKb} kB\nMemFree:          1000 kB\nMemAvailable:   ${availableKb} kB\n`;

  function probe(scenario: {
    endpoint?: string;
    kernel?: string;
    daemonTotalBytes?: number;
    available?: () => number;
    dockerFails?: () => boolean;
    now?: () => number;
    cpus?: unknown;
    /** Holds a /proc/meminfo read, taken as it starts, until the promise
     * it returns settles; undefined lets it through at once. */
    hold?: () => Promise<void> | undefined;
  }) {
    const totalKb = 16 * 1024 * 1024;
    let dockerCalls = 0;
    let reads = 0;
    let pressureReads = 0;
    const instance = new HostMemoryProbe({
      env: {},
      kernelRelease: () => '6.10.14-linuxkit',
      ...(scenario.now ? { now: scenario.now } : {}),
      readFile: (path) => {
        if (path.startsWith('/proc/pressure/')) {
          pressureReads += 1;
          return Promise.resolve(
            'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
          );
        }
        reads += 1;
        const text = meminfo(totalKb, scenario.available?.() ?? 4194304);
        const held = scenario.hold?.();
        return held === undefined
          ? Promise.resolve(text)
          : held.then(() => text);
      },
      docker: (args) => {
        dockerCalls += 1;
        if (scenario.dockerFails?.() === true) {
          return Promise.resolve({
            exitCode: 124,
            stdout: '',
            stderr: 'timed out',
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        }
        const stdout =
          args[0] === 'context'
            ? JSON.stringify(scenario.endpoint ?? 'unix:///var/run/docker.sock')
            : JSON.stringify({
                cpus: 'cpus' in scenario ? scenario.cpus : 8,
                memory: scenario.daemonTotalBytes ?? totalKb * 1024,
                kernel: scenario.kernel ?? '6.10.14-linuxkit',
              });
        return Promise.resolve({
          exitCode: 0,
          stdout,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      },
    });
    return {
      instance,
      dockerCalls: () => dockerCalls,
      reads: () => reads,
      pressureReads: () => pressureReads,
    };
  }

  test('reads MemAvailable where /proc describes the Docker host', async () => {
    const { instance } = probe({});
    expect(await instance.read()).toEqual({
      totalBytes: 16 * GIB,
      availableBytes: 4 * GIB,
    });
  });

  test.each([
    ['a remote daemon', { endpoint: 'tcp://10.0.0.5:2376' }],
    ['another kernel', { kernel: '5.15.0-generic' }],
    ['another total', { daemonTotalBytes: 32 * GIB }],
  ])(
    'answers null for %s, leaving admission to the count',
    async (_, scenario) => {
      expect(await probe(scenario).instance.read()).toBeNull();
    },
  );

  test('reuses a reading briefly, judges the host once, and reads afresh on request', async () => {
    let available = 4 * 1024 * 1024;
    const { instance, dockerCalls } = probe({ available: () => available });
    expect((await instance.read())?.availableBytes).toBe(4 * GIB);
    available = 2 * 1024 * 1024;
    expect((await instance.read())?.availableBytes).toBe(4 * GIB);
    expect((await instance.read(true))?.availableBytes).toBe(2 * GIB);
    expect(dockerCalls()).toBe(2);
  });

  test('concurrent reads share one', async () => {
    let now = 1_000_000;
    const { instance, reads } = probe({ now: () => now });
    await instance.read();
    // The verdict read /proc once, the reading once.
    expect(reads()).toBe(2);
    now += 5_000;
    const shared = await Promise.all([
      instance.read(),
      instance.read(),
      instance.read(),
    ]);
    expect(shared.every((m) => m?.availableBytes === 4 * GIB)).toBe(true);
    expect(reads()).toBe(3);
  });

  test('a Docker CLI that could not answer is asked again within a minute, not in ten', async () => {
    let now = 1_000_000;
    let fails = true;
    const { instance } = probe({ now: () => now, dockerFails: () => fails });
    expect(await instance.read()).toBeNull();
    fails = false;
    now += 31_000;
    expect((await instance.read())?.availableBytes).toBe(4 * GIB);
  });

  test('a re-judge the Docker CLI cannot answer keeps a good verdict', async () => {
    let now = 1_000_000;
    let fails = false;
    let available = 2 * 1024 * 1024;
    const { instance } = probe({
      now: () => now,
      dockerFails: () => fails,
      available: () => available,
    });
    expect((await instance.read())?.availableBytes).toBe(2 * GIB);
    // Ten minutes on, the verdict is due again while every CLI slot is busy.
    fails = true;
    available = 3 * 1024 * 1024;
    now += 10 * 60_000 + 1;
    expect((await instance.read())?.availableBytes).toBe(3 * GIB);
    // Still failing at the quick retry: still the host's memory.
    now += 31_000;
    expect((await instance.read())?.availableBytes).toBe(3 * GIB);
  });

  test("reads the CPUs the daemon reports beside the host's memory", async () => {
    const { instance } = probe({ cpus: 12 });
    expect(instance.cpus()).toBeNull();
    await instance.read();
    expect(instance.cpus()).toBe(12);
  });

  test('no CPUs where /proc is not the Docker host, and it says so', async () => {
    const { instance } = probe({ endpoint: 'tcp://10.0.0.5:2376' });
    await instance.read();
    expect(instance.cpus()).toBeNull();
    expect(await instance.describesHost()).toBe(false);
  });

  test('its judgement of the host is the one the pressure sampler reads by', async () => {
    const { instance, dockerCalls } = probe({});
    expect(await instance.describesHost()).toBe(true);
    await instance.read();
    // Judged once: the memory reading and the sampler share the verdict.
    expect(dockerCalls()).toBe(2);
  });

  test('it never reads the pressure stall files: the pressure sampler is their one reader', async () => {
    const { instance, pressureReads } = probe({});
    await instance.read();
    await instance.read(true);
    expect(pressureReads()).toBe(0);
  });

  test.each([[0], [-2], [1.5], ['8'], [null]])(
    'a daemon CPU count of %p is no CPU count',
    async (cpus) => {
      const { instance } = probe({ cpus });
      await instance.read();
      expect(instance.cpus()).toBeNull();
    },
  );

  test('a short reading taken before the clock stepped back is read again, not kept for the step', async () => {
    let now = 1_000_000;
    let available = 512 * 1024;
    const { instance } = probe({ now: () => now, available: () => available });
    expect((await instance.read())?.availableBytes).toBe(GIB / 2);
    // The clock steps back an hour (NTP, a resumed VM) as memory frees up.
    now -= 60 * 60_000;
    available = 4 * 1024 * 1024;
    expect((await instance.read())?.availableBytes).toBe(4 * GIB);
    expect(instance.latest()?.availableBytes).toBe(4 * GIB);
  });

  test('a slower read that started before the clock stepped back never replaces the newer reading', async () => {
    let now = 1_000_000;
    let available = 1024 * 1024;
    let holdNext = false;
    const slowFile = Promise.withResolvers<void>();
    const { instance } = probe({
      now: () => now,
      available: () => available,
      hold: () => {
        if (!holdNext) return undefined;
        holdNext = false;
        return slowFile.promise;
      },
    });
    expect((await instance.read())?.availableBytes).toBe(GIB);
    // A read finds 512 MiB available, and is slow to land...
    now += 5_000;
    available = 512 * 1024;
    holdNext = true;
    const slow = instance.read(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(holdNext).toBe(false);
    // ...while the clock steps back an hour, and a newer read finds 4 GiB.
    now -= 60 * 60_000;
    available = 4 * 1024 * 1024;
    expect((await instance.read(true))?.availableBytes).toBe(4 * GIB);
    expect(instance.latest()?.availableBytes).toBe(4 * GIB);
    slowFile.resolve();
    expect((await slow)?.availableBytes).toBe(GIB / 2);
    expect(instance.latest()?.availableBytes).toBe(4 * GIB);
    expect((await instance.read())?.availableBytes).toBe(4 * GIB);
  });

  test('a Docker CLI that could not answer before the clock stepped back is asked again, not after the step', async () => {
    let now = 1_000_000;
    let fails = true;
    const { instance } = probe({ now: () => now, dockerFails: () => fails });
    expect(await instance.read()).toBeNull();
    fails = false;
    now -= 60 * 60_000;
    expect((await instance.read(true))?.availableBytes).toBe(4 * GIB);
  });

  test('started, it keeps the reading admission decides with fresh', async () => {
    let available = 4 * 1024 * 1024;
    const { instance } = probe({ available: () => available });
    await instance.read();
    available = 2 * 1024 * 1024;
    instance.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
      expect(instance.latest()?.availableBytes).toBe(2 * GIB);
    } finally {
      instance.stop();
    }
  });
});
