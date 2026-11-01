import { describe, expect, test } from 'bun:test';

import {
  assessHostPressure,
  CONSERVATIVE_THRESHOLDS,
  defaultPresetThresholds,
  dominantSignal,
  presetThresholds,
  thresholdsKey,
  tightenThresholds,
  type HostPressureReading,
  type PressureThresholds,
} from './host-pressure-assessment.ts';

const NOW = 1_800_000_000_000;

/** A quiet reading `ago` ms before now, with any values overridden. */
function reading(
  ago: number,
  values: Partial<Omit<HostPressureReading, 'atMs'>> = {},
): HostPressureReading {
  return {
    atMs: NOW - ago,
    load1: 1,
    cpus: 4,
    cpuPsi: 0,
    memoryPsi: 0,
    ioPsi: 0,
    cpuTicks: null,
    idleTicks: null,
    ...values,
  };
}

const DEFAULT = defaultPresetThresholds(60);
const CONSERVATIVE = { ...CONSERVATIVE_THRESHOLDS };

function assess(
  readings: HostPressureReading[],
  thresholds: PressureThresholds = CONSERVATIVE,
  extra: { pressured?: boolean; lastStartAtMs?: number } = {},
) {
  return assessHostPressure({
    readings,
    thresholds,
    pressured: extra.pressured ?? false,
    now: NOW,
    ...(extra.lastStartAtMs === undefined
      ? {}
      : { lastStartAtMs: extra.lastStartAtMs }),
  });
}

describe('presets', () => {
  test('default is the spawner CPU pressure alone, at SANDBOX_CPU_PRESSURE_PERCENT', () => {
    expect(presetThresholds('default', 60)).toEqual({
      loadPerCpu: null,
      cpuPsi: 60,
      memoryPsi: null,
      ioPsi: null,
      recover: 0.5,
    });
    // 0 switches the CPU off, leaving nothing to judge.
    expect(presetThresholds('default', 0).cpuPsi).toBeNull();
  });

  test('conservative watches load, CPU, memory and I/O', () => {
    expect(presetThresholds('conservative', 60)).toEqual({
      loadPerCpu: 1,
      cpuPsi: 20,
      memoryPsi: 1,
      ioPsi: 10,
      recover: 0.5,
    });
  });

  test('tightening takes the stricter threshold per signal, an off signal as no limit', () => {
    const deployment: PressureThresholds = {
      loadPerCpu: null,
      cpuPsi: 15,
      memoryPsi: 5,
      ioPsi: null,
      recover: 0.6,
    };
    expect(tightenThresholds(deployment, CONSERVATIVE)).toEqual({
      loadPerCpu: 1,
      cpuPsi: 15,
      memoryPsi: 1,
      ioPsi: 10,
      recover: 0.5,
    });
    // Never looser than either side.
    expect(tightenThresholds(DEFAULT, DEFAULT)).toEqual(DEFAULT);
  });

  test('distinct thresholds keep distinct hysteresis keys', () => {
    expect(thresholdsKey(DEFAULT)).toBe(thresholdsKey({ ...DEFAULT }));
    expect(thresholdsKey(DEFAULT)).not.toBe(thresholdsKey(CONSERVATIVE));
    expect(thresholdsKey(DEFAULT)).not.toBe(
      thresholdsKey({ ...DEFAULT, recover: 0.4 }),
    );
  });
});

describe('assessHostPressure', () => {
  test('with no signal switched on there is nothing to judge, and it admits', () => {
    const result = assess([], defaultPresetThresholds(0));
    expect(result).toMatchObject({
      verdict: 'admit',
      reason: null,
      pressured: false,
      score: null,
      retryAfterMs: null,
    });
  });

  test('no readings at all is unavailable', () => {
    expect(assess([])).toMatchObject({
      verdict: 'hold',
      reason: 'unavailable',
      score: null,
      retryAfterMs: 60_000,
      evidence: { first: null, last: null },
    });
  });

  test('a newest reading older than 30 s is stale', () => {
    const result = assess([reading(45_000), reading(31_000)]);
    expect(result).toMatchObject({
      verdict: 'hold',
      reason: 'stale',
      retryAfterMs: 5_000,
    });
    expect(result.evidence.last?.atMs).toBe(NOW - 31_000);
  });

  test('a newest reading stamped ahead of now, the clock having stepped back since, is stale', () => {
    const result = assess([reading(-5_000), reading(-15_000)]);
    expect(result).toMatchObject({
      verdict: 'hold',
      reason: 'stale',
      retryAfterMs: 5_000,
    });
    expect(result.evidence.last?.atMs).toBe(NOW + 15_000);
  });

  test('no pair at least 10 s apart is stale', () => {
    expect(assess([reading(9_000), reading(0)]).reason).toBe('stale');
    expect(assess([reading(0)]).reason).toBe('stale');
  });

  test('no pair at most 60 s apart is stale', () => {
    expect(assess([reading(61_000), reading(0)]).reason).toBe('stale');
  });

  test('the pair is the newest reading and the newest one at least 10 s before it', () => {
    const result = assess([
      reading(30_000),
      reading(15_000),
      reading(10_000),
      reading(5_000),
      reading(0),
    ]);
    expect(result.verdict).toBe('admit');
    expect(result.evidence.first?.atMs).toBe(NOW - 10_000);
    expect(result.evidence.last?.atMs).toBe(NOW);
  });

  test('readings in any order are paired the same way', () => {
    const result = assess([reading(0), reading(20_000), reading(12_000)]);
    expect(result.evidence.first?.atMs).toBe(NOW - 12_000);
  });

  test('a switched-on signal either reading lacks is unavailable', () => {
    expect(
      assess([reading(10_000), reading(0, { memoryPsi: null })]),
    ).toMatchObject({ verdict: 'hold', reason: 'unavailable', score: null });
    expect(assess([reading(10_000, { cpus: null }), reading(0)]).reason).toBe(
      'unavailable',
    );
    // A signal that is off may be missing.
    expect(
      assess([reading(10_000), reading(0, { memoryPsi: null })], DEFAULT)
        .verdict,
    ).toBe('admit');
  });

  test.each([
    ['load per CPU', { load1: 4 }, 1],
    ['CPU pressure', { cpuPsi: 20 }, 1],
    ['memory pressure', { memoryPsi: 1 }, 1],
    ['I/O pressure', { ioPsi: 10 }, 1],
  ])('%s at its threshold presses the host', (_, values, score) => {
    const result = assess([reading(10_000), reading(0, values)]);
    expect(result).toMatchObject({
      verdict: 'hold',
      reason: 'pressure',
      pressured: true,
      score,
      retryAfterMs: 15_000,
    });
  });

  test('the score is the worst ratio across both readings and every signal', () => {
    const result = assess([
      reading(10_000, { cpuPsi: 18, load1: 2 }),
      reading(0, { cpuPsi: 4, ioPsi: 7 }),
    ]);
    expect(result.verdict).toBe('admit');
    expect(result.score).toBeCloseTo(0.9);
    expect(result.evidence.signals).toEqual({
      cpu: { threshold: 20, ratio: 0.9 },
      memory: { threshold: 1, ratio: 0 },
      io: { threshold: 10, ratio: 0.7 },
      load: { threshold: 1, ratio: 0.5 },
    });
    expect(dominantSignal(result)).toBe('cpu');
  });

  test('an earlier reading over its threshold presses the host until it leaves the pair', () => {
    expect(assess([reading(10_000, { memoryPsi: 3 }), reading(0)]).reason).toBe(
      'pressure',
    );
  });

  test('a signal switched off is not judged', () => {
    const result = assess(
      [reading(10_000), reading(0, { memoryPsi: 50, ioPsi: 90, load1: 40 })],
      DEFAULT,
    );
    expect(result.verdict).toBe('admit');
    expect(result.evidence.signals.memory).toEqual({
      threshold: null,
      ratio: null,
    });
  });

  describe('hysteresis', () => {
    const at = (cpuPsi: number, pressured: boolean) =>
      assess([reading(10_000, { cpuPsi }), reading(0, { cpuPsi })], DEFAULT, {
        pressured,
      });

    test('enters at the threshold', () => {
      expect(at(59, false)).toMatchObject({
        verdict: 'admit',
        pressured: false,
      });
      expect(at(60, false)).toMatchObject({ verdict: 'hold', pressured: true });
    });

    test('holds while the score stays at or above the recover share', () => {
      expect(at(45, true)).toMatchObject({
        verdict: 'hold',
        reason: 'pressure',
        pressured: true,
      });
      expect(at(30, true).pressured).toBe(true);
    });

    test('recovers below the recover share', () => {
      expect(at(29, true)).toMatchObject({
        verdict: 'admit',
        pressured: false,
      });
    });

    test('a custom recover share moves where it recovers', () => {
      const thresholds = { ...DEFAULT, recover: 0.9 };
      const result = assess(
        [reading(10_000, { cpuPsi: 50 }), reading(0, { cpuPsi: 50 })],
        thresholds,
        { pressured: true },
      );
      expect(result.pressured).toBe(false);
    });

    test('an assessment without a score carries the prior state on', () => {
      expect(assess([], DEFAULT, { pressured: true }).pressured).toBe(true);
      expect(
        assess([reading(40_000), reading(31_000)], DEFAULT, { pressured: true })
          .pressured,
      ).toBe(true);
    });
  });

  describe('pacing', () => {
    test('a start not yet followed by a fresh pair of readings holds', () => {
      const result = assess([reading(10_000), reading(0)], CONSERVATIVE, {
        lastStartAtMs: NOW - 4_000,
      });
      expect(result).toMatchObject({
        verdict: 'hold',
        reason: 'pacing',
        pressured: false,
        score: 0.25,
        retryAfterMs: 6_000,
      });
    });

    test('a start at the first reading still holds; one before it does not', () => {
      expect(
        assess([reading(10_000), reading(0)], CONSERVATIVE, {
          lastStartAtMs: NOW - 10_000,
        }).reason,
      ).toBe('pacing');
      expect(
        assess([reading(10_000), reading(0)], CONSERVATIVE, {
          lastStartAtMs: NOW - 10_001,
        }).verdict,
      ).toBe('admit');
    });

    test('asks again in at least a second', () => {
      expect(
        assess([reading(30_000), reading(0)], CONSERVATIVE, {
          lastStartAtMs: NOW - 20_000,
        }).retryAfterMs,
      ).toBe(1_000);
    });

    test('a pressed host is held for its pressure, not for pacing', () => {
      expect(
        assess([reading(10_000), reading(0, { ioPsi: 30 })], CONSERVATIVE, {
          lastStartAtMs: NOW - 1_000,
        }).reason,
      ).toBe('pressure');
    });

    test('unknown readings are unavailable before pacing is judged', () => {
      expect(
        assess([reading(10_000), reading(0, { cpuPsi: null })], CONSERVATIVE, {
          lastStartAtMs: NOW - 1_000,
        }).reason,
      ).toBe('unavailable');
    });
  });

  test('a preset tightened by the conservative one judges by the stricter thresholds', () => {
    const relaxed: PressureThresholds = {
      loadPerCpu: null,
      cpuPsi: 90,
      memoryPsi: null,
      ioPsi: null,
      recover: 0.5,
    };
    const pair = [reading(10_000), reading(0, { cpuPsi: 40 })];
    expect(assess(pair, relaxed).verdict).toBe('admit');
    expect(assess(pair, tightenThresholds(relaxed, CONSERVATIVE)).verdict).toBe(
      'hold',
    );
  });

  test('the dominant signal names what presses the host most, the CPU on a tie', () => {
    const memory = assess([
      reading(10_000),
      reading(0, { memoryPsi: 4, cpuPsi: 30 }),
    ]);
    expect(dominantSignal(memory)).toBe('memory');
    const tie = assess([
      reading(10_000),
      reading(0, { memoryPsi: 2, cpuPsi: 40 }),
    ]);
    expect(dominantSignal(tie)).toBe('cpu');
    expect(dominantSignal(assess([]))).toBeNull();
  });
});

describe("the CPU stall counts only as far as the host's CPUs were busy", () => {
  /** What a heavy-phase lease judges by: the deployment's thresholds,
   * tightened by the conservative preset. */
  const LEASE = tightenThresholds(DEFAULT, CONSERVATIVE);

  /** Two readings ten seconds apart at `cpuPsi`, the host's CPU time
   * `busyPercent` busy between them: 4,000 ticks of its four CPUs. */
  const pair = (cpuPsi: number, busyPercent: number) => [
    reading(10_000, { cpuPsi, cpuTicks: 1_000_000, idleTicks: 400_000 }),
    reading(0, {
      cpuPsi,
      cpuTicks: 1_004_000,
      idleTicks: 400_000 + 40 * (100 - busyPercent),
    }),
  ];

  // Sessions held back by their quota of two CPUs on a host of twelve: one
  // building (17 % busy), two (33 %), and the thirteen of agents.tale.dev on
  // 2026-10-30 (60 %), each reading as most of the host's time stalled.
  test.each([
    [70, 17],
    [89, 33],
    [87, 60],
  ])(
    'a stall of %d percent beside CPUs %d percent busy admits starts and leases, a pressed host too',
    (cpuPsi, busy) => {
      for (const thresholds of [DEFAULT, LEASE]) {
        for (const pressured of [false, true]) {
          const result = assess(pair(cpuPsi, busy), thresholds, { pressured });
          expect(result).toMatchObject({
            verdict: 'admit',
            reason: null,
            pressured: false,
          });
          expect(result.evidence.cpuBusy).toBeCloseTo(busy);
          expect(result.evidence.signals.cpu.ratio).toBe(0);
        }
      }
    },
  );

  test.each([
    [70, 95],
    [89, 100],
  ])(
    'a stall of %d percent with the CPUs %d percent busy holds starts and leases',
    (cpuPsi, busy) => {
      for (const thresholds of [DEFAULT, LEASE]) {
        const result = assess(pair(cpuPsi, busy), thresholds);
        expect(result).toMatchObject({
          verdict: 'hold',
          reason: 'pressure',
          pressured: true,
        });
        expect(result.evidence.signals.cpu.ratio).toBeCloseTo(
          cpuPsi / (thresholds.cpuPsi ?? 0),
        );
        expect(dominantSignal(result)).toBe('cpu');
      }
    },
  );

  test('between 80 and 90 % busy the stall counts in proportion', () => {
    const ratio = (busy: number) =>
      assess(pair(50, busy), LEASE).evidence.signals.cpu.ratio;
    expect(ratio(80)).toBeCloseTo(0);
    expect(ratio(85)).toBeCloseTo(1.25);
    expect(ratio(90)).toBeCloseTo(2.5);
    expect(assess(pair(50, 85), LEASE).verdict).toBe('hold');
    expect(assess(pair(50, 85), DEFAULT).verdict).toBe('admit');
  });

  test('an unknown busy share counts the stall as it reads', () => {
    const counted = [
      reading(10_000, { cpuPsi: 70, cpuTicks: 1_000_000, idleTicks: 400_000 }),
      reading(0, { cpuPsi: 70, cpuTicks: 1_004_000, idleTicks: 402_000 }),
    ] as const;
    for (const readings of [
      // Neither reading has the counters, or one lacks them…
      [reading(10_000, { cpuPsi: 70 }), reading(0, { cpuPsi: 70 })],
      [counted[0], reading(0, { cpuPsi: 70 })],
      // …or they went backwards, or did not move.
      [
        reading(10_000, {
          cpuPsi: 70,
          cpuTicks: 2_000_000,
          idleTicks: 400_000,
        }),
        counted[1],
      ],
      [counted[0], { ...counted[0], atMs: NOW }],
    ]) {
      const result = assess(readings, DEFAULT);
      expect(result).toMatchObject({ verdict: 'hold', reason: 'pressure' });
      expect(result.evidence.cpuBusy).toBeNull();
    }
    // The same stall with half the host's CPU time idle counts not at all.
    expect(assess([...counted], DEFAULT).evidence.cpuBusy).toBe(50);
    expect(assess([...counted], DEFAULT).verdict).toBe('admit');
  });
});
