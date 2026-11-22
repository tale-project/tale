import { describe, expect, test } from 'bun:test';

import {
  MEMORY_BUDGET_BYTES,
  MIB,
  OVERLAP_BOUND_BYTES,
} from '../../src/budget/limits.ts';
import {
  type BudgetObservation,
  type FlipFigures,
  budgetExitCode,
  judgeBudget,
  renderBudgetMarkdown,
  renderSeriesCsv,
  restFigures,
} from '../../src/budget/report.ts';
import type {
  ContainerFigures,
  Instant,
  SamplingFigures,
} from '../../src/budget/sampler.ts';
import type {
  HttpErrorCount,
  WorkloadPart,
} from '../../src/budget/workload.ts';

function container(
  name: string,
  service: string,
  peakMib: number,
  share: ContainerFigures['share'],
  extra: Partial<ContainerFigures> = {},
): ContainerFigures {
  return {
    id: name,
    name,
    project: 'tale-x',
    service,
    colour: null,
    share,
    cgroup: `/sys/fs/cgroup/system.slice/docker-${name}.scope`,
    via: 'proc',
    firstSeenMs: 0,
    lastReadMs: 60_000,
    goneMs: null,
    unresolved: null,
    samples: 240,
    peakCounted: peakMib * MIB,
    peakCountedAtMs: 30_000,
    peakFields: null,
    fileAtPeak: 10 * MIB,
    peakFile: 20 * MIB,
    peakFileAtMs: 40_000,
    lastCounted: peakMib * MIB,
    readErrors: 0,
    firstReadError: null,
    ...extra,
  };
}

const SERVICES = [
  'platform',
  'db',
  'object-store',
  'proxy',
  'docker-api',
  'sandbox',
  'sandbox-egress',
];

function deployment(platformMib: number): ContainerFigures[] {
  return [
    container('tale-x-blue-platform-1', 'platform', platformMib, 'app-tier', {
      colour: 'blue',
      project: 'tale-x-blue',
    }),
    container('tale-x-db', 'db', 110, 'postgres'),
    container('tale-x-object-store', 'object-store', 30, 'object-store'),
    container('tale-x-proxy', 'proxy', 25, 'edge'),
    container('tale-x-docker-api', 'docker-api', 5, 'edge'),
    container('tale-x-sandbox', 'sandbox', 20, 'spawner-egress'),
    container('tale-x-sandbox-egress', 'sandbox-egress', 3, 'spawner-egress'),
  ];
}

function instant(containers: ContainerFigures[], atMs = 30_000): Instant {
  const parts = containers.map((c) => ({
    name: c.name,
    service: c.service,
    colour: c.colour,
    counted: c.peakCounted,
    file: c.fileAtPeak,
  }));
  const counted = parts.reduce((sum, part) => sum + part.counted, 0);
  return { atMs, counted, total: counted, overlap: 0, file: 70 * MIB, parts };
}

function workloadPart(
  key: WorkloadPart['key'],
  expected: number,
  completed = expected,
): WorkloadPart {
  return {
    key,
    label: key,
    expected,
    completed,
    startedAtMs: 15_000,
    endedAtMs: 75_000,
    outcome: completed >= expected ? 'completed' : 'failed',
    details: completed >= expected ? [] : [`${key} fell short`],
  };
}

function flip(overrides: Partial<FlipFigures> = {}): FlipFigures {
  return {
    command: 'tale --yes --ci deploy --skip-backup',
    startedAtMs: 80_000,
    endedAtMs: 170_000,
    exitCode: 0,
    signal: null,
    timedOut: false,
    tail: ['Deployment complete: green is serving'],
    ...overrides,
  };
}

function observation(
  containers: ContainerFigures[],
  overrides: {
    sampling?: Partial<Omit<SamplingFigures, 'series'>>;
    parts?: WorkloadPart[];
    flip?: FlipFigures | null;
    httpErrors?: HttpErrorCount[];
  } = {},
): BudgetObservation {
  return {
    settings: {
      target: 'https://localhost',
      project: 'tale-x',
      services: SERVICES,
      organizationId: 'org-1',
      settleSeconds: 15,
      tailSeconds: 15,
      deadlineSeconds: 1_800,
      host: {
        arch: 'x64',
        cpus: 4,
        totalMemoryBytes: 16 * 1024 ** 3,
        kernel: '6.8.0',
      },
    },
    sampling: {
      intervalMs: 250,
      discoveryMs: 1_000,
      startedAt: '2026-11-22T03:41:00.000Z',
      durationMs: 120_000,
      engine: {
        cgroupDriver: 'systemd',
        cgroupVersion: 2,
        serverVersion: '28.1.1',
        architecture: 'x86_64',
        rootless: false,
      },
      instants: 480,
      maxGapMs: 270,
      lateInstants: 0,
      listings: 120,
      listingErrors: 0,
      firstListingError: null,
      maxListingGapMs: 1_150,
      cgroupConflicts: [],
      containers,
      shares: [
        {
          key: 'app-tier',
          peakCounted: containers[0]?.peakCounted ?? 0,
          peakAtMs: 30_000,
        },
        { key: 'postgres', peakCounted: 110 * MIB, peakAtMs: 30_000 },
        { key: 'object-store', peakCounted: 30 * MIB, peakAtMs: 30_000 },
        { key: 'edge', peakCounted: 30 * MIB, peakAtMs: 30_000 },
        { key: 'spawner-egress', peakCounted: 23 * MIB, peakAtMs: 30_000 },
      ],
      unshared: { peakCounted: 0, peakAtMs: null },
      peak: instant(containers),
      overlap: { instants: 0, peak: 0, peakAtMs: null },
      marks: [{ label: 'workload', atMs: 15_000 }],
      ...overrides.sampling,
    },
    rest: {
      instants: 60,
      peakCountedBytes: 330 * MIB,
      meanCountedBytes: 320 * MIB,
    },
    workload: {
      startedAtMs: 15_000,
      durationMs: 60_000,
      timedOut: false,
      parts: overrides.parts ?? [
        workloadPart('chat', 24),
        workloadPart('run-code', 1),
        workloadPart('agent-task', 1),
        workloadPart('documents', 2),
        workloadPart('transcription', 1),
        workloadPart('sign-ins', 10),
      ],
      facts: ['Spreadsheet: 60,000 rows × 10 columns'],
      httpErrors: overrides.httpErrors ?? [],
    },
    flip: overrides.flip === undefined ? null : overrides.flip,
  };
}

const outcomeOf = (
  report: ReturnType<typeof judgeBudget>,
  key: string,
): string | undefined => report.checks.find((c) => c.key === key)?.outcome;

/** `containers` with the one of `service` changed. */
function withChange(
  containers: ContainerFigures[],
  service: string,
  change: Partial<ContainerFigures>,
): ContainerFigures[] {
  const changed = containers.find((c) => c.service === service);
  if (changed === undefined) throw new Error(`no ${service} to change`);
  Object.assign(changed, change);
  return containers;
}

/** The deployment over the budget by `bytes` at its peak. */
function over(containers: ContainerFigures[], bytes: number): Instant {
  return { ...instant(containers), counted: MEMORY_BUDGET_BYTES + bytes };
}

describe('judgeBudget', () => {
  test('a whole reading of a completed workload under the budget passes', () => {
    const report = judgeBudget(observation(deployment(200)));
    // 200 + 110 + 30 + 25 + 5 + 20 + 3 = 393 MiB, 412 MB.
    expect(report.sampling.peak?.counted).toBe(393 * MIB);
    expect(
      report.checks.map((check) => [check.key, check.outcome, check.pass]),
    ).toEqual([
      ['reading', 'held', true],
      ['workload', 'held', true],
      ['budget', 'held', true],
      ['overlap', 'not tested', true],
    ]);
    expect(report.verdict).toBe('pass');
    expect(report.pass).toBe(true);
    expect(report.conclusive).toBe(true);
    expect(budgetExitCode(report)).toBe(0);
    expect(report.limitBytes).toBe(500_000_000);
    expect(report.runningAtPeak).toHaveLength(6);
    expect(report.shares.find((share) => share.key === 'postgres')).toEqual({
      key: 'postgres',
      label: 'Postgres',
      shareBytes: 120 * MIB,
      peakCountedBytes: 110 * MIB,
      peakAtMs: 30_000,
      within: true,
    });
  });

  test('one byte over 500,000,000 fails, and names in bytes what held the memory', () => {
    const containers = deployment(200);
    const report = judgeBudget(
      observation(containers, { sampling: { peak: over(containers, 1) } }),
    );
    const budget = report.checks.find((check) => check.key === 'budget');
    expect(budget?.outcome).toBe('missed');
    expect(budget?.details[0]).toBe('1 byte over the budget at +30.0 s:');
    expect(budget?.details[1]).toBe(
      '  tale-x-blue-platform-1: 209,715,200 bytes',
    );
    expect(report.verdict).toBe('fail');
    expect(report.conclusive).toBe(true);
    expect(budgetExitCode(report)).toBe(1);
    // Exactly the limit is within it.
    const at = judgeBudget(
      observation(containers, { sampling: { peak: over(containers, 0) } }),
    );
    expect(at.pass).toBe(true);
  });

  test('a workload that did less fails the run, whatever the reading', () => {
    const report = judgeBudget(
      observation(deployment(150), {
        parts: [workloadPart('chat', 24, 20), workloadPart('documents', 2, 1)],
      }),
    );
    const workload = report.checks.find((check) => check.key === 'workload');
    expect(workload?.outcome).toBe('missed');
    expect(workload?.details).toContain('chat: failed, 20 of 24');
    expect(budgetExitCode(report)).toBe(1);
    // On a reading that is not whole too: the work fell short either way.
    const partial = judgeBudget(
      observation(
        deployment(150).filter((c) => c.service !== 'docker-api'),
        { parts: [workloadPart('chat', 24, 20)] },
      ),
    );
    expect(budgetExitCode(partial)).toBe(1);
  });

  test('a service never read, or a gap a peak could hide in, makes a run within the budget inconclusive', () => {
    const containers = deployment(200).filter(
      (c) => c.service !== 'docker-api',
    );
    containers.push(
      container('tale-x-sandbox-2', 'sandbox', 0, 'spawner-egress', {
        samples: 0,
        unresolved: 'no cgroup with a memory.stat',
      }),
    );
    const report = judgeBudget(
      observation(containers, {
        sampling: { maxGapMs: 1_400, lateInstants: 2 },
      }),
    );
    const reading = report.checks.find((check) => check.key === 'reading');
    expect(reading?.outcome).toBe('inconclusive');
    expect(reading?.details).toEqual([
      'no container of docker-api was read: the deployment is not the one the budget covers, or it was down',
      'tale-x-sandbox-2 ran and was never read: no cgroup with a memory.stat',
      '2 instants came late; the longest gap was 1400 ms, longer than 1000 ms: a peak may have passed unseen',
    ]);
    // Within the budget on such a reading proves nothing either way.
    expect(outcomeOf(report, 'budget')).toBe('inconclusive');
    expect(report.verdict).toBe('inconclusive');
    expect(report.conclusive).toBe(false);
    expect(budgetExitCode(report)).toBe(2);
  });

  test('a peak above the budget fails even on a reading that is not whole: what it missed can only add to it', () => {
    // A service unread.
    const partial = deployment(200).filter((c) => c.service !== 'proxy');
    const unread = judgeBudget(
      observation(partial, {
        sampling: { peak: over(partial, 150_000_000) },
      }),
    );
    expect(outcomeOf(unread, 'reading')).toBe('inconclusive');
    expect(outcomeOf(unread, 'budget')).toBe('missed');
    expect(unread.checks.find((c) => c.key === 'budget')?.details[0]).toContain(
      'on a reading that is not whole',
    );
    expect(unread.verdict).toBe('fail');
    expect(unread.conclusive).toBe(true);
    expect(budgetExitCode(unread)).toBe(1);
    // One failed read of the egress proxy, 650 MB read (the review's probe).
    const containers = withChange(deployment(200), 'sandbox-egress', {
      readErrors: 1,
      firstReadError: 'EIO once',
    });
    expect(
      budgetExitCode(
        judgeBudget(
          observation(containers, {
            sampling: { peak: over(containers, 150_000_000) },
          }),
        ),
      ),
    ).toBe(1);
    // A gap of 1.2 s in a run that read 900 MB.
    const whole = deployment(200);
    expect(
      budgetExitCode(
        judgeBudget(
          observation(whole, {
            sampling: {
              maxGapMs: 1_200,
              lateInstants: 1,
              peak: over(whole, 400_000_000),
            },
          }),
        ),
      ),
    ).toBe(1);
  });

  test('a container whose reads failed leaves the reading not whole', () => {
    const containers = withChange(deployment(200), 'db', {
      readErrors: 3,
      firstReadError: 'EIO',
    });
    const report = judgeBudget(observation(containers));
    expect(
      report.checks.find((check) => check.key === 'reading')?.details,
    ).toEqual(['tale-x-db: 3 reads failed (EIO)']);
    expect(budgetExitCode(report)).toBe(2);
  });

  test('two containers on one cgroup leave the reading not whole', () => {
    const report = judgeBudget(
      observation(deployment(200), {
        sampling: {
          cgroupConflicts: [
            "tale-x-proxy: its cgroup /sys/fs/cgroup/x is tale-x-db's, read already: read for both, its memory would count twice",
          ],
        },
      }),
    );
    expect(
      report.checks.find((check) => check.key === 'reading')?.details[0],
    ).toStartWith('one cgroup for two containers: tale-x-proxy:');
    expect(budgetExitCode(report)).toBe(2);
  });

  test('a container list not read for longer than five seconds leaves the reading not whole', () => {
    const stale = judgeBudget(
      observation(deployment(200), {
        sampling: {
          maxListingGapMs: 6_200,
          listingErrors: 5,
          firstListingError: 'docker ps failed: Cannot connect',
        },
      }),
    );
    expect(
      stale.checks.find((check) => check.key === 'reading')?.details,
    ).toEqual([
      'the container list went 6.2 s without a listing (5 of 125 failed, the first: docker ps failed: Cannot connect), longer than 5.0 s: a container that started meanwhile went unread',
    ]);
    expect(budgetExitCode(stale)).toBe(2);
    const fresh = judgeBudget(
      observation(deployment(200), { sampling: { maxListingGapMs: 5_000 } }),
    );
    expect(budgetExitCode(fresh)).toBe(0);
    const never = judgeBudget(
      observation(deployment(200), { sampling: { maxListingGapMs: null } }),
    );
    expect(
      never.checks.find((check) => check.key === 'reading')?.details,
    ).toEqual(['the container list was never read']);
  });
});

describe('the blue/green overlap', () => {
  const overlapping = (peak: number) => ({
    overlap: { instants: 12, peak, peakAtMs: 120_000 },
  });

  test('without a flip the bound is not tested, and never reads as held', () => {
    const report = judgeBudget(observation(deployment(200)));
    const overlap = report.checks.find((check) => check.key === 'overlap');
    expect(overlap?.outcome).toBe('not tested');
    expect(overlap?.figure).toBe('no overlap');
    expect(overlap?.details[0]).toContain('the bound was not exercised');
    expect(budgetExitCode(report)).toBe(0);
    expect(renderBudgetMarkdown(report)).toContain(
      '| no overlap | not tested |',
    );
  });

  test('a flip that overlapped within one app-tier share holds; exactly one share is within it', () => {
    const report = judgeBudget(
      observation(deployment(200), {
        sampling: overlapping(OVERLAP_BOUND_BYTES),
        flip: flip(),
      }),
    );
    const overlap = report.checks.find((check) => check.key === 'overlap');
    expect(overlap?.outcome).toBe('held');
    expect(overlap?.figure).toBe(
      'peak 268,435,456 bytes (256.0 MiB) over 12 instants',
    );
    expect(overlap?.details[0]).toBe(
      'the flip (`tale --yes --ci deploy --skip-backup`) ran from +80.0 s to +170.0 s and exited 0',
    );
    expect(budgetExitCode(report)).toBe(0);
  });

  test('one byte above one app-tier share fails, on a reading that is not whole too', () => {
    const beyond = judgeBudget(
      observation(deployment(200), {
        sampling: overlapping(OVERLAP_BOUND_BYTES + 1),
        flip: flip(),
      }),
    );
    expect(outcomeOf(beyond, 'overlap')).toBe('missed');
    expect(
      beyond.checks.find((check) => check.key === 'overlap')?.details[0],
    ).toBe(
      'the second colour held 268,435,457 bytes at +120.0 s, 1 byte over one app-tier share',
    );
    expect(budgetExitCode(beyond)).toBe(1);
    const partial = judgeBudget(
      observation(
        deployment(200).filter((c) => c.service !== 'proxy'),
        { sampling: overlapping(300 * MIB), flip: flip() },
      ),
    );
    expect(outcomeOf(partial, 'overlap')).toBe('missed');
    expect(budgetExitCode(partial)).toBe(1);
  });

  test('a flip asked for that never overlapped is inconclusive', () => {
    const report = judgeBudget(observation(deployment(200), { flip: flip() }));
    const overlap = report.checks.find((check) => check.key === 'overlap');
    expect(overlap?.outcome).toBe('inconclusive');
    expect(overlap?.details).toEqual([
      'no instant read two colours of the app tier at once: the flip asked for never overlapped, so the bound was not exercised',
      'the flip (`tale --yes --ci deploy --skip-backup`) ran from +80.0 s to +170.0 s and exited 0',
      '  Deployment complete: green is serving',
    ]);
    expect(budgetExitCode(report)).toBe(2);
  });

  test('a flip that failed, or ran out of time, within the bound is inconclusive', () => {
    for (const failed of [
      flip({ exitCode: 1 }),
      flip({ exitCode: null, signal: 'SIGTERM', timedOut: true }),
    ]) {
      const report = judgeBudget(
        observation(deployment(200), {
          sampling: overlapping(100 * MIB),
          flip: failed,
        }),
      );
      expect(outcomeOf(report, 'overlap')).toBe('inconclusive');
      expect(budgetExitCode(report)).toBe(2);
    }
  });

  test('the flip is named among what ran at the peak', () => {
    const containers = deployment(200);
    const report = judgeBudget(
      observation(containers, {
        sampling: { peak: instant(containers, 100_000) },
        flip: flip(),
      }),
    );
    expect(report.runningAtPeak).toEqual(['the blue/green flip']);
  });
});

describe('renderBudgetMarkdown', () => {
  test('the verdict first, then the peak, the shares, the containers and the workload', () => {
    const markdown = renderBudgetMarkdown(
      judgeBudget(observation(deployment(200))),
    );
    expect(markdown.split('\n')[0]).toBe(
      '# Memory budget (x64): peak 412,090,368 of 500,000,000 bytes — WITHIN THE BUDGET',
    );
    expect(markdown).toContain(
      'The deployment peaked at **412,090,368 bytes**',
    );
    expect(markdown).toContain('| tale-x-db | 110.0 MiB | 10.0 MiB |');
    expect(markdown).toContain(
      '| Postgres | 120.0 MiB | 110.0 MiB | +30.0 s | 92 % |',
    );
    expect(markdown).toContain(
      'At rest before the workload: 320.0 MiB on average, 330.0 MiB at most',
    );
    expect(markdown).toContain(
      '| chat | 24/24 | completed | +15.0 s | +75.0 s |',
    );
    expect(markdown).toContain('- Spreadsheet: 60,000 rows × 10 columns');
    expect(markdown).toContain(
      'None: every request and stream was answered as expected.',
    );
  });

  test('a run just over the limit says so in bytes, not in rounded megabytes', () => {
    const containers = deployment(200);
    const report = judgeBudget(
      observation(containers, { sampling: { peak: over(containers, 40_000) } }),
    );
    const markdown = renderBudgetMarkdown(report);
    expect(markdown.split('\n')[0]).toBe(
      '# Memory budget (x64): peak 500,040,000 of 500,000,000 bytes — FAILED',
    );
    expect(markdown).not.toContain('500.0 MB of 500.0 MB');
    expect(markdown).toContain('40,000 bytes over the budget at +30.0 s:');
  });

  test('an inconclusive run says so in its title', () => {
    const containers = deployment(200).filter((c) => c.service !== 'db');
    const markdown = renderBudgetMarkdown(judgeBudget(observation(containers)));
    expect(markdown.split('\n')[0]).toEndWith('— INCONCLUSIVE');
    expect(markdown).toContain('| **inconclusive** |');
  });

  test('the HTTP errors the workload met, by request and kind', () => {
    const markdown = renderBudgetMarkdown(
      judgeBudget(
        observation(deployment(200), {
          httpErrors: [
            {
              name: 'sse.events.connect',
              kind: 'http_401',
              count: 2,
              sample: 'GET /events?orgId=org-1 -> 401: unauthorized',
            },
          ],
        }),
      ),
    );
    expect(markdown).toContain(
      '| sse.events.connect | http_401 | 2 | GET /events?orgId=org-1 -> 401: unauthorized |',
    );
  });
});

describe('the series and the rest', () => {
  const series: SamplingFigures['series'] = [
    {
      atMs: 0,
      counted: 100,
      file: 10,
      overlap: 0,
      byContainer: new Map([
        [0, 60],
        [1, 40],
      ]),
    },
    {
      atMs: 250,
      counted: 120,
      file: 11,
      overlap: 0,
      byContainer: new Map([
        [0, 80],
        [1, 40],
      ]),
    },
    {
      atMs: 500,
      counted: 300,
      file: 12,
      overlap: 5,
      byContainer: new Map([[1, 300]]),
    },
  ];

  test('the CSV has a column per container, empty where it was not read', () => {
    const figures = {
      ...observation(deployment(100)).sampling,
      containers: deployment(100).slice(0, 2),
      series,
    } as SamplingFigures;
    expect(renderSeriesCsv(figures)).toBe(
      [
        'at_ms,counted,page_cache,overlap,tale-x-blue-platform-1,tale-x-db',
        '0,100,10,0,60,40',
        '250,120,11,0,80,40',
        '500,300,12,5,,300',
        '',
      ].join('\n'),
    );
  });

  test('the rest is every instant before the workload began', () => {
    expect(restFigures(series, 400)).toEqual({
      instants: 2,
      peakCountedBytes: 120,
      meanCountedBytes: 110,
    });
    expect(restFigures(series, 0)).toBeNull();
  });
});
