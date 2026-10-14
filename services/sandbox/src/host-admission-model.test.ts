import { describe, expect, test } from 'bun:test';

import {
  assessHostAdmission,
  type HostAdmissionRequest,
  type HostAdmissionSnapshot,
} from './host-admission-model.ts';

const GIB = 1024 ** 3;
const NOW = 100_000;

function fixture(): {
  snapshot: HostAdmissionSnapshot;
  request: HostAdmissionRequest;
} {
  const identity = {
    daemonId: 'daemon-a',
    hostBootId: 'boot-a',
    filesystemId: 'fs-a',
    authorityGeneration: 'authority-a',
  };
  const reading = {
    identity,
    onlineCpus: 8,
    load1: 1,
    cpuPsi: 1,
    memoryPsi: 0,
    ioPsi: 0,
    memoryTotalBytes: 64 * GIB,
    memoryAvailableBytes: 32 * GIB,
    diskAvailableBytes: 60 * GIB,
  };
  return {
    snapshot: {
      identity,
      epoch: 3,
      lastStartedAt: 50_000,
      pressured: false,
      holds: [],
      readings: [
        { ...reading, observedAt: 70_000 },
        { ...reading, observedAt: 90_000 },
      ],
    },
    request: {
      hold: {
        id: 'phase-1',
        kind: 'phase',
        memoryBytes: 4 * GIB,
        diskBytes: 8 * GIB,
      },
      expectedEpoch: 3,
      nativeDiskReserveBytes: 4 * GIB,
    },
  };
}

describe('exclusive host admission arithmetic', () => {
  test('admits a fresh same-host pair with actual native headroom', () => {
    const { snapshot, request } = fixture();
    expect(assessHostAdmission(snapshot, request, NOW)).toEqual({
      admitted: true,
      pressured: false,
    });
  });

  test.each([
    'daemonId',
    'hostBootId',
    'filesystemId',
    'authorityGeneration',
  ] as const)('refuses a mixed %s identity', (field) => {
    const { snapshot, request } = fixture();
    snapshot.readings[1].identity = { ...snapshot.identity, [field]: 'other' };
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: false,
      reason: 'unavailable',
    });
  });

  test('refuses stale epoch, pre-start sample, bad interval, future and old samples', () => {
    const cases = [
      (s: HostAdmissionSnapshot) => {
        s.epoch++;
      },
      (s: HostAdmissionSnapshot) => {
        s.lastStartedAt = s.readings[0].observedAt;
      },
      (s: HostAdmissionSnapshot) => {
        s.readings[0].observedAt = 80_001;
      },
      (s: HostAdmissionSnapshot) => {
        s.lastStartedAt = 0;
        s.readings[0].observedAt = 1;
      },
      (s: HostAdmissionSnapshot) => {
        s.readings[1].observedAt = NOW + 1;
      },
      (s: HostAdmissionSnapshot) => {
        s.lastStartedAt = 0;
        s.readings[0].observedAt = 50_000;
        s.readings[1].observedAt = 69_999;
      },
    ];
    for (const mutate of cases) {
      const { snapshot, request } = fixture();
      mutate(snapshot);
      expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
        admitted: false,
        reason: 'stale',
      });
    }
  });

  test('retains exact inclusive freshness and interval boundaries', () => {
    for (const [first, last, now] of [
      [60_000, 70_000, 100_000],
      [60_000, 120_000, 120_000],
    ]) {
      const { snapshot, request } = fixture();
      snapshot.readings[0].observedAt = first!;
      snapshot.readings[1].observedAt = last!;
      expect(assessHostAdmission(snapshot, request, now!)).toMatchObject({
        admitted: true,
      });
    }
  });

  test.each(['load1', 'cpuPsi', 'memoryPsi', 'ioPsi'] as const)(
    'holds when either observation proves %s pressure',
    (field) => {
      const levels = { load1: 8, cpuPsi: 20, memoryPsi: 1, ioPsi: 10 };
      for (const index of [0, 1] as const) {
        const { snapshot, request } = fixture();
        snapshot.readings[index][field] = levels[field];
        expect(assessHostAdmission(snapshot, request, NOW)).toEqual({
          admitted: false,
          reason: 'pressure',
          pressured: true,
        });
      }
    },
  );

  test('pressure hysteresis needs both observations below the recovery threshold', () => {
    const { snapshot, request } = fixture();
    snapshot.pressured = true;
    snapshot.readings[0].memoryPsi = 0.5;
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: false,
      reason: 'pressure',
    });
    snapshot.readings[0].memoryPsi = 0.49;
    expect(assessHostAdmission(snapshot, request, NOW)).toEqual({
      admitted: true,
      pressured: false,
    });
  });

  test('all ordinary writers count outstanding phase growth', () => {
    for (const kind of ['create', 'activate'] as const) {
      const { snapshot, request } = fixture();
      request.hold.kind = kind;
      snapshot.holds = [
        {
          id: 'unsettled-phase',
          kind: 'phase',
          memoryBytes: 24 * GIB,
          diskBytes: 0,
        },
      ];
      expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
        admitted: false,
        reason: 'memory',
      });
    }
  });

  test('both unsettled phase slots stay occupied without time-based expiry', () => {
    const { snapshot, request } = fixture();
    snapshot.holds = ['old-unknown', 'stopping'].map((id) => ({
      id,
      kind: 'phase',
      memoryBytes: GIB,
      diskBytes: 0,
    }));
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: false,
      reason: 'phase_limit',
    });
    request.hold.kind = 'activate';
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: true,
    });
  });

  test('duplicate reservations are refused, not counted a second time', () => {
    const { snapshot, request } = fixture();
    snapshot.holds = [request.hold];
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: false,
      reason: 'duplicate',
    });
    snapshot.holds = [request.hold, request.hold];
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: false,
      reason: 'unavailable',
    });
  });

  test('uses the lower free-disk observation and retains the stronger native floor', () => {
    const { snapshot, request } = fixture();
    snapshot.readings[0].diskAvailableBytes = 28 * GIB;
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: true,
    });
    snapshot.readings[0].diskAvailableBytes--;
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: false,
      reason: 'disk',
    });
    snapshot.readings[0].diskAvailableBytes = 30 * GIB;
    request.nativeDiskReserveBytes = 24 * GIB;
    expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
      admitted: false,
      reason: 'disk',
    });
  });

  test('invalid, mismatched and overflowing observations never become capacity', () => {
    const cases = [
      (s: HostAdmissionSnapshot) => {
        s.readings[0].cpuPsi = NaN;
      },
      (s: HostAdmissionSnapshot) => {
        s.readings[0].onlineCpus = 4;
      },
      (s: HostAdmissionSnapshot) => {
        s.readings[0].memoryTotalBytes = 32 * GIB;
      },
      (s: HostAdmissionSnapshot) => {
        s.readings[0].memoryAvailableBytes = 65 * GIB;
      },
      (s: HostAdmissionSnapshot) => {
        s.readings[0].diskAvailableBytes = -1;
      },
      (s: HostAdmissionSnapshot) => {
        s.holds = [
          {
            id: 'overflow',
            kind: 'create',
            memoryBytes: Number.MAX_SAFE_INTEGER,
            diskBytes: 0,
          },
        ];
      },
    ];
    for (const mutate of cases) {
      const { snapshot, request } = fixture();
      mutate(snapshot);
      expect(assessHostAdmission(snapshot, request, NOW)).toMatchObject({
        admitted: false,
        reason: 'unavailable',
      });
    }
  });
});
