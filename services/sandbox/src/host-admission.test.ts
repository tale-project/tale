import { describe, expect, spyOn, test } from 'bun:test';

import type { HeavyLeaseRequest } from './heavy-leases.ts';
import {
  admissionConfigOf,
  HostAdmission,
  type StartRoom,
} from './host-admission.ts';
import type { HostDisk } from './host-disk.ts';
import type { HostMemory } from './host-memory.ts';
import {
  CONSERVATIVE_THRESHOLDS,
  type HostPressureReading,
} from './host-pressure-assessment.ts';
import type { HostPressureSource } from './host-pressure.ts';
import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';
import type { AdmissionConfig, SpawnerConfig } from './types.ts';

type AdmissionCfg = Pick<SpawnerConfig, 'admission' | 'session'>;

const GIB = 1024 ** 3;
const NOW = 1_800_000_000_000;

type Values = Partial<Omit<HostPressureReading, 'atMs'>>;

/** A host read every five seconds: `tick` lands the next reading with
 * `values` (quiet unless named) and tells the listeners. */
function host(initial: Values = {}) {
  let now = NOW;
  const ring: HostPressureReading[] = [];
  const listeners = new Set<() => void>();
  const push = (values: Values) => {
    ring.push({
      atMs: now,
      load1: 0.4,
      cpus: 4,
      cpuPsi: 1,
      memoryPsi: 0,
      ioPsi: 0,
      ...values,
    });
  };
  push(initial);
  now += 10_000;
  push(initial);
  const source: HostPressureSource = {
    readings: () => [...ring],
    onReading: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    tick: (values: Values = {}) => {
      now += 5_000;
      push(values);
      for (const listener of listeners) listener();
    },
  };
}

const memory = (availableGib: number, totalGib = 16) => ({
  latest: (): HostMemory => ({
    totalBytes: totalGib * GIB,
    availableBytes: availableGib * GIB,
  }),
});

/** A 200 GiB workspace disk (its floor 10 GiB) with `freeGib` free, and
 * Docker's data disk apart when named. */
const disk = (
  freeGib: number,
  dockerData?: HostDisk | null,
): {
  latest(): HostDisk | null;
  byFilesystem(): {
    workspace: HostDisk | null;
    dockerData: HostDisk | null | undefined;
  };
} => {
  const workspace: HostDisk = {
    totalBytes: 200 * GIB,
    availableBytes: freeGib * GIB,
  };
  return {
    latest: () =>
      dockerData === null || dockerData === undefined
        ? workspace
        : dockerData.availableBytes < workspace.availableBytes
          ? dockerData
          : workspace,
    byFilesystem: () => ({ workspace, dockerData }),
  };
};

function config(settings?: Partial<AdmissionConfig>): AdmissionCfg {
  return {
    session: { ...TEST_SESSION_CONFIG, cpuPressurePercent: 60 },
    ...(settings === undefined
      ? {}
      : {
          admission: {
            preset: 'default',
            thresholds: {
              loadPerCpu: null,
              cpuPsi: 60,
              memoryPsi: null,
              ioPsi: null,
              recover: 0.5,
            },
            heavyLeasesMax: 2,
            heavyMinFreeDiskBytes: 20 * GIB,
            ...settings,
          },
        }),
  };
}

const CONSERVATIVE_DEPLOYMENT: Partial<AdmissionConfig> = {
  preset: 'conservative',
  thresholds: { ...CONSERVATIVE_THRESHOLDS },
};

const ROOMY: StartRoom = {
  memoryShort: false,
  diskShort: false,
  sessions: { running: 3, starting: 1 },
};

const LEASE: HeavyLeaseRequest = {
  organizationId: 'org_a',
  label: 'npm ci',
  predictedGrowthBytes: 2 * GIB,
  memoryBytes: GIB,
  ttlMs: 60_000,
};

function admission(
  cfg: AdmissionCfg,
  scenario: {
    host?: ReturnType<typeof host>;
    memory?: ReturnType<typeof memory> | null;
    disk?: ReturnType<typeof disk> | null;
  } = {},
) {
  const h = scenario.host ?? host();
  const instance = new HostAdmission(cfg, {
    pressure: h.source,
    ...(scenario.memory === null
      ? {}
      : { memory: scenario.memory ?? memory(12) }),
    ...(scenario.disk === null ? {} : { disk: scenario.disk ?? disk(150) }),
    now: h.now,
  });
  return { instance, host: h };
}

describe('settings', () => {
  test('a config naming none judges by the default preset at its CPU threshold', () => {
    const cfg = {
      session: { ...TEST_SESSION_CONFIG, cpuPressurePercent: 35 },
    };
    expect(admissionConfigOf(cfg)).toEqual({
      preset: 'default',
      thresholds: {
        loadPerCpu: null,
        cpuPsi: 35,
        memoryPsi: null,
        ioPsi: null,
        recover: 0.5,
      },
      heavyLeasesMax: 2,
      heavyMinFreeDiskBytes: 20 * GIB,
    });
  });

  test('a caller can only tighten the deployment', () => {
    const { instance } = admission(config({}));
    expect(instance.effective()).toEqual({
      preset: 'default',
      thresholds: instance.settings.thresholds,
    });
    expect(instance.effective('default')).toEqual(instance.effective());
    expect(instance.effective('conservative')).toEqual({
      preset: 'conservative',
      thresholds: { ...CONSERVATIVE_THRESHOLDS },
    });
    const strict = admission(config(CONSERVATIVE_DEPLOYMENT)).instance;
    expect(strict.effective('default').preset).toBe('conservative');
    // An operator's stricter threshold survives a conservative request.
    const tight = admission(
      config({
        thresholds: {
          loadPerCpu: null,
          cpuPsi: 10,
          memoryPsi: null,
          ioPsi: null,
          recover: 0.3,
        },
      }),
    ).instance;
    expect(tight.effective('conservative').thresholds).toEqual({
      loadPerCpu: 1,
      cpuPsi: 10,
      memoryPsi: 1,
      ioPsi: 10,
      recover: 0.3,
    });
  });
});

describe('the start gate session admission paces by', () => {
  test('unknown pressure is no pressure', () => {
    const quiet = admission(config(), { host: host({ cpuPsi: null }) });
    expect(quiet.instance.startPressure()).toEqual({
      pressured: false,
      signal: null,
    });
  });

  test('a pressed host names what presses it most', () => {
    const { instance } = admission(config(CONSERVATIVE_DEPLOYMENT), {
      host: host({ cpuPsi: 5, ioPsi: 30 }),
    });
    expect(instance.startPressure()).toEqual({ pressured: true, signal: 'io' });
  });

  test("the hysteresis follows the host's readings, not the moments someone asked", () => {
    const h = host({ cpuPsi: 70 });
    const { instance } = admission(config(), { host: h });
    h.tick({ cpuPsi: 70 });
    // Nobody asked while it eased below half its threshold…
    h.tick({ cpuPsi: 20 });
    h.tick({ cpuPsi: 20 });
    h.tick({ cpuPsi: 20 });
    h.tick({ cpuPsi: 20 });
    // …so a reading between half and the whole of it finds it recovered.
    h.tick({ cpuPsi: 40 });
    h.tick({ cpuPsi: 40 });
    expect(instance.startPressure().pressured).toBe(false);
  });

  test('a pressed host stays pressed while its readings stay above the recover share', () => {
    const h = host({ cpuPsi: 70 });
    const { instance } = admission(config(), { host: h });
    h.tick({ cpuPsi: 70 });
    h.tick({ cpuPsi: 40 });
    h.tick({ cpuPsi: 40 });
    h.tick({ cpuPsi: 40 });
    expect(instance.startPressure().pressured).toBe(true);
  });

  test('crossing the deployment thresholds is said once each way', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const h = host();
      admission(config(), { host: h });
      h.tick({ cpuPsi: 80 });
      h.tick({ cpuPsi: 80 });
      h.tick({ cpuPsi: 5 });
      h.tick({ cpuPsi: 5 });
      h.tick({ cpuPsi: 5 });
      const pressed = warn.mock.calls.filter((call) =>
        String(call[0]).includes('under pressure'),
      );
      const eased = log.mock.calls.filter((call) =>
        String(call[0]).includes('pressure eased'),
      );
      expect(pressed).toHaveLength(1);
      expect(String(pressed[0]?.[0])).toContain('cpu at 133% of its 60');
      expect(eased).toHaveLength(1);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  test('a start is remembered as the latest one', () => {
    const { instance } = admission(config());
    expect(instance.lastStartAtMs()).toBeNull();
    instance.noteStart(NOW + 5);
    instance.noteStart(NOW + 1);
    expect(instance.lastStartAtMs()).toBe(NOW + 5);
  });
});

describe('the admission answer', () => {
  test('a quiet host admits, with the whole evidence', () => {
    const { instance, host: h } = admission(config());
    const answer = instance.answer('start', undefined, ROOMY);
    expect(answer).toEqual({
      verdict: 'admit',
      reason: null,
      retryAfterMs: null,
      preset: 'default',
      observedAtMs: h.now(),
      evidence: {
        pressure: {
          first: expect.objectContaining({ atMs: NOW }),
          last: expect.objectContaining({ atMs: NOW + 10_000 }),
          score: 1 / 60,
          pressured: false,
          thresholds: instance.settings.thresholds,
        },
        memory: {
          availableBytes: 12 * GIB,
          reserveBytes: Math.floor((16 * GIB) / 10),
          totalBytes: 16 * GIB,
        },
        disk: { freeBytes: 150 * GIB, floorBytes: 10 * GIB, short: false },
        sessions: { running: 3, starting: 1, limit: 10 },
        leases: { active: 0, max: 2 },
      },
    });
  });

  test.each([
    ['not the Docker host', (): HostPressureSource => ({ readings: () => [] })],
    [
      'a kernel without pressure stall information',
      (): HostPressureSource => host({ cpuPsi: null }).source,
    ],
  ])(
    '%s: the default preset admits, saying why it could not judge',
    (_, source) => {
      const instance = new HostAdmission(config(), {
        pressure: source(),
        now: () => NOW + 10_000,
      });
      expect(instance.answer('start', undefined, ROOMY)).toMatchObject({
        verdict: 'admit',
        reason: 'unavailable',
        retryAfterMs: null,
        preset: 'default',
      });
      // A conservative caller holds instead.
      expect(instance.answer('start', 'conservative', ROOMY)).toMatchObject({
        verdict: 'hold',
        reason: 'unavailable',
        retryAfterMs: 60_000,
        preset: 'conservative',
      });
    },
  );

  test('a deployment set to conservative holds where it cannot judge', () => {
    const instance = new HostAdmission(config(CONSERVATIVE_DEPLOYMENT), {
      pressure: { readings: () => [] },
    });
    expect(instance.answer('start', 'default', ROOMY)).toMatchObject({
      verdict: 'hold',
      reason: 'unavailable',
      preset: 'conservative',
    });
  });

  test('readings that stopped coming are stale: admitted by default, held by conservative', () => {
    const h = host();
    const { instance } = admission(config(), { host: h });
    h.advance(31_000);
    expect(instance.answer('start', undefined, ROOMY)).toMatchObject({
      verdict: 'admit',
      reason: 'stale',
    });
    expect(instance.answer('start', 'conservative', ROOMY)).toMatchObject({
      verdict: 'hold',
      reason: 'stale',
      retryAfterMs: 5_000,
    });
  });

  test('a pressed host holds for 15 s', () => {
    const { instance } = admission(config(), { host: host({ cpuPsi: 75 }) });
    expect(instance.answer('start', undefined, ROOMY)).toMatchObject({
      verdict: 'hold',
      reason: 'pressure',
      retryAfterMs: 15_000,
      evidence: { pressure: { pressured: true, score: 1.25 } },
    });
  });

  test('a conservative caller is held where the deployment would admit', () => {
    const { instance } = admission(config(), {
      host: host({ memoryPsi: 2 }),
    });
    expect(instance.answer('start', undefined, ROOMY).verdict).toBe('admit');
    expect(instance.answer('start', 'conservative', ROOMY)).toMatchObject({
      verdict: 'hold',
      reason: 'pressure',
      preset: 'conservative',
      evidence: {
        pressure: { thresholds: { ...CONSERVATIVE_THRESHOLDS } },
      },
    });
  });

  test('a start is followed by a fresh pair of readings before the next', () => {
    const h = host();
    const { instance } = admission(config(), { host: h });
    // Started as the newest reading landed.
    instance.noteStart(h.now());
    expect(instance.answer('start', undefined, ROOMY)).toMatchObject({
      verdict: 'hold',
      reason: 'pacing',
      retryAfterMs: 10_000,
    });
    h.tick();
    expect(instance.answer('start', undefined, ROOMY).reason).toBe('pacing');
    // The pair now starts with the reading the start landed beside.
    h.tick();
    expect(instance.answer('start', undefined, ROOMY).reason).toBe('pacing');
    // A reading after the start, and one ten seconds after that.
    h.tick();
    expect(instance.answer('start', undefined, ROOMY)).toMatchObject({
      verdict: 'admit',
      reason: null,
    });
  });

  test('session admission short of disk or memory holds first', () => {
    const { instance } = admission(config(), { host: host({ cpuPsi: 90 }) });
    expect(
      instance.answer('start', undefined, { ...ROOMY, diskShort: true }),
    ).toMatchObject({ verdict: 'hold', reason: 'disk', retryAfterMs: 60_000 });
    expect(
      instance.answer('start', undefined, { ...ROOMY, memoryShort: true }),
    ).toMatchObject({
      verdict: 'hold',
      reason: 'memory',
      retryAfterMs: 15_000,
    });
  });

  test('unknown memory and disk read as no evidence', () => {
    const { instance } = admission(config(), { memory: null, disk: null });
    expect(instance.answer('start', undefined, ROOMY).evidence).toMatchObject({
      memory: null,
      disk: null,
    });
  });

  test('the kind heavy answers what a lease of the default size would be told, taking none', () => {
    const { instance } = admission(config());
    expect(instance.answer('heavy', undefined, ROOMY)).toMatchObject({
      verdict: 'admit',
      reason: null,
      preset: 'conservative',
    });
    expect(instance.leases.active()).toEqual([]);
    instance.acquireLease('ses-1', LEASE, ROOMY.sessions);
    instance.acquireLease('ses-2', LEASE, ROOMY.sessions);
    expect(instance.answer('heavy', 'default', ROOMY)).toMatchObject({
      verdict: 'hold',
      reason: 'limit',
      retryAfterMs: 30_000,
      evidence: { leases: { active: 2, max: 2 } },
    });
  });

  test('the kind heavy is never paced', () => {
    const h = host();
    const { instance } = admission(config(), { host: h });
    instance.noteStart(h.now());
    expect(instance.answer('heavy', undefined, ROOMY).verdict).toBe('admit');
  });
});

describe('heavy-phase leases', () => {
  test('a lease is granted on a quiet host with room', () => {
    const { instance } = admission(config());
    const decision = instance.acquireLease('ses-1', LEASE, ROOMY.sessions);
    expect(decision).toMatchObject({
      granted: true,
      lease: { sessionId: 'ses-1', organizationId: 'org_a', class: 'heavy' },
    });
  });

  test('pressure under the conservative thresholds refuses, whatever the deployment', () => {
    const { instance } = admission(config(), { host: host({ ioPsi: 12 }) });
    expect(instance.acquireLease('ses-1', LEASE, ROOMY.sessions)).toMatchObject(
      {
        granted: false,
        reason: 'pressure',
        retryAfterMs: 15_000,
        evidence: { pressure: { pressured: true } },
      },
    );
  });

  test('a host that cannot be judged refuses', () => {
    const instance = new HostAdmission(config(), {
      pressure: { readings: () => [] },
      memory: memory(12),
      disk: disk(150),
    });
    expect(instance.acquireLease('ses-1', LEASE, ROOMY.sessions)).toMatchObject(
      {
        granted: false,
        reason: 'unavailable',
      },
    );
    const h = host();
    const stale = admission(config(), { host: h });
    h.advance(40_000);
    expect(
      stale.instance.acquireLease('ses-1', LEASE, ROOMY.sessions),
    ).toMatchObject({ granted: false, reason: 'stale' });
  });

  test('a lease is never refused for pacing', () => {
    const h = host();
    const { instance } = admission(config(), { host: h });
    instance.noteStart(h.now());
    expect(instance.acquireLease('ses-1', LEASE, ROOMY.sessions).granted).toBe(
      true,
    );
  });

  test('the most heavy phases at once', () => {
    const { instance } = admission(config({ heavyLeasesMax: 1 }));
    expect(instance.acquireLease('ses-1', LEASE, ROOMY.sessions).granted).toBe(
      true,
    );
    expect(instance.acquireLease('ses-2', LEASE, ROOMY.sessions)).toMatchObject(
      {
        granted: false,
        reason: 'limit',
      },
    );
  });

  test("disk: each phase's announced growth counts beside the others", () => {
    // 30 GiB free, 20 GiB kept: room for 10 GiB of announced growth.
    const { instance } = admission(config({ heavyLeasesMax: 8 }), {
      disk: disk(30),
    });
    const four = { ...LEASE, predictedGrowthBytes: 4 * GIB };
    expect(instance.acquireLease('ses-1', four, ROOMY.sessions).granted).toBe(
      true,
    );
    expect(instance.acquireLease('ses-2', four, ROOMY.sessions).granted).toBe(
      true,
    );
    expect(instance.acquireLease('ses-3', four, ROOMY.sessions)).toMatchObject({
      granted: false,
      reason: 'disk',
      retryAfterMs: 60_000,
    });
    expect(
      instance.acquireLease(
        'ses-3',
        { ...LEASE, predictedGrowthBytes: 2 * GIB },
        ROOMY.sessions,
      ).granted,
    ).toBe(true);
  });

  test('disk: the floor counts where it is above SANDBOX_HEAVY_MIN_FREE_DISK, and 0 keeps only the floor', () => {
    // 200 GiB disk: a 10 GiB floor.
    const onlyFloor = admission(config({ heavyMinFreeDiskBytes: 0 }), {
      disk: disk(13),
    }).instance;
    expect(onlyFloor.acquireLease('ses-1', LEASE, ROOMY.sessions).granted).toBe(
      true,
    );
    const floorFirst = admission(config({ heavyMinFreeDiskBytes: GIB }), {
      disk: disk(11),
    }).instance;
    expect(
      floorFirst.acquireLease('ses-1', LEASE, ROOMY.sessions),
    ).toMatchObject({ granted: false, reason: 'disk' });
  });

  test("disk: Docker's data disk watched apart binds when it has less room", () => {
    const { instance } = admission(config(), {
      disk: disk(150, { totalBytes: 100 * GIB, availableBytes: 21 * GIB }),
    });
    expect(instance.acquireLease('ses-1', LEASE, ROOMY.sessions)).toMatchObject(
      {
        granted: false,
        reason: 'disk',
      },
    );
  });

  test('disk: a Docker data disk that cannot be read is judged by the workspace, unless admission requires it', () => {
    const unread = admission(config(), { disk: disk(150, null) }).instance;
    expect(unread.acquireLease('ses-1', LEASE, ROOMY.sessions).granted).toBe(
      true,
    );
    const required = admission(config(), {
      disk: {
        latest: () => ({ totalBytes: 0, availableBytes: 0, unavailable: true }),
        byFilesystem: () => ({
          workspace: { totalBytes: 200 * GIB, availableBytes: 150 * GIB },
          dockerData: null,
        }),
      },
    }).instance;
    expect(required.acquireLease('ses-1', LEASE, ROOMY.sessions)).toMatchObject(
      { granted: false, reason: 'unavailable' },
    );
  });

  test('a disk or memory that cannot be read refuses', () => {
    const noDisk = admission(config(), { disk: null }).instance;
    expect(noDisk.acquireLease('ses-1', LEASE, ROOMY.sessions)).toMatchObject({
      granted: false,
      reason: 'unavailable',
      retryAfterMs: 60_000,
    });
    const noMemory = admission(config(), { memory: null }).instance;
    expect(noMemory.acquireLease('ses-1', LEASE, ROOMY.sessions)).toMatchObject(
      { granted: false, reason: 'unavailable' },
    );
  });

  test("memory: each phase's announced memory counts beside the others, the reserve kept", () => {
    // 16 GiB host: a 1.6 GiB reserve; 4 GiB available leaves 2.4 GiB.
    const { instance } = admission(config({ heavyLeasesMax: 8 }), {
      memory: memory(4),
    });
    expect(instance.acquireLease('ses-1', LEASE, ROOMY.sessions).granted).toBe(
      true,
    );
    expect(instance.acquireLease('ses-2', LEASE, ROOMY.sessions).granted).toBe(
      true,
    );
    expect(instance.acquireLease('ses-3', LEASE, ROOMY.sessions)).toMatchObject(
      {
        granted: false,
        reason: 'memory',
        retryAfterMs: 15_000,
      },
    );
  });

  test('an expired lease no longer counts', () => {
    const h = host();
    const { instance } = admission(config({ heavyLeasesMax: 1 }), { host: h });
    expect(instance.acquireLease('ses-1', LEASE, ROOMY.sessions).granted).toBe(
      true,
    );
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    h.tick();
    expect(instance.acquireLease('ses-2', LEASE, ROOMY.sessions).granted).toBe(
      true,
    );
  });
});
