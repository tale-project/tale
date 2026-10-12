import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Automation } from '../../../lib/engine/core/types.ts';
import { assembleAutomationAuthoringHost } from '../../core/automations/authoring_host.ts';
import { RateLimitExceededError } from '../../lib/rate-limit.ts';

const io = vi.hoisted(() => ({ charge: vi.fn() }));
vi.mock('../../lib/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('../../lib/rate-limit.ts')>()),
  checkOrganizationRateLimit: io.charge,
}));

import {
  admitBenchRun,
  admitBenchRuns,
  BENCH_CONCURRENCY,
  runTestsByHand,
  tryRun,
  VALUE_BYTES_MAX,
} from './bench.ts';

// The code runner the routes install before any run.
beforeAll(() => {
  assembleAutomationAuthoringHost();
});

/** A store with nothing in it: these documents call no other automation. */
const store = {
  list: async () => [],
  get: async () => null,
  deployedVersion: async () => null,
};

const echo = (code: string): Automation => ({
  version: 1,
  name: 'echo',
  nodes: [{ id: 'say', type: 'transform', code }],
  output: '{{ nodes.say.output }}',
});

describe('admitBenchRun', () => {
  it('holds a few runs at a time per process, and gives a place back once', () => {
    const held = Array.from({ length: BENCH_CONCURRENCY }, () =>
      admitBenchRun(),
    );
    expect(held.every((release) => release !== null)).toBe(true);
    expect(admitBenchRun()).toBeNull();
    const first = held[0]!;
    first();
    // Giving it back twice frees one place, not two.
    first();
    const next = admitBenchRun();
    expect(next).not.toBeNull();
    expect(admitBenchRun()).toBeNull();
    next?.();
    for (const release of held.slice(1)) release?.();
  });
});

/** How many of this process's places are free: every one it can take,
 * taken and given back. */
function freePlaces(): number {
  const held: Array<() => void> = [];
  for (;;) {
    const place = admitBenchRun();
    if (place === null) break;
    held.push(place);
  }
  for (const release of held) release();
  return held.length;
}

describe('admitBenchRuns', () => {
  const sql = {} as never;

  beforeEach(() => {
    io.charge.mockReset();
    io.charge.mockResolvedValue(undefined);
  });

  it('charges the organization one unit per run, then takes a place, and gives it back once', async () => {
    const release = await admitBenchRuns(sql, 'org-1', 3);
    expect(io.charge).toHaveBeenCalledWith(sql, 'automation:bench', 'org-1', 3);
    expect(freePlaces()).toBe(BENCH_CONCURRENCY - 1);
    release();
    // Giving it back twice frees one place, not two.
    release();
    expect(freePlaces()).toBe(BENCH_CONCURRENCY);
  });

  it('charges at least one unit', async () => {
    (await admitBenchRuns(sql, 'org-1', 0))();
    expect(io.charge).toHaveBeenCalledWith(sql, 'automation:bench', 'org-1', 1);
  });

  it('takes no place when the budget is spent, and passes the wait on', async () => {
    io.charge.mockRejectedValueOnce(
      new RateLimitExceededError('spent', 30_000),
    );
    await expect(admitBenchRuns(sql, 'org-1', 1)).rejects.toMatchObject({
      retryAfter: 30_000,
    });
    expect(freePlaces()).toBe(BENCH_CONCURRENCY);
  });

  it('asks for two seconds when every place is taken, having charged', async () => {
    const held = Array.from({ length: BENCH_CONCURRENCY }, () =>
      admitBenchRun(),
    );
    await expect(admitBenchRuns(sql, 'org-1', 1)).rejects.toMatchObject({
      name: 'RateLimitExceededError',
      retryAfter: 2_000,
    });
    expect(io.charge).toHaveBeenCalledOnce();
    for (const place of held) place?.();
  });

  it('lets a fault in the budget through as the fault it is', async () => {
    io.charge.mockRejectedValueOnce(new Error('connection refused'));
    await expect(admitBenchRuns(sql, 'org-1', 1)).rejects.toThrow(
      'connection refused',
    );
    expect(freePlaces()).toBe(BENCH_CONCURRENCY);
  });
});

describe('tryRun', () => {
  it('runs a draft once and names the document it ran', async () => {
    const first = await tryRun({ document: echo("return 'hi';"), store });
    const again = await tryRun({ document: echo("return 'hi';"), store });
    expect(first.status).toBe('success');
    expect(first.output).toBe('hi');
    expect(first.record).toBeDefined();
    expect(first.documentHash).toBe(again.documentHash);
    const other = await tryRun({ document: echo("return 'ho';"), store });
    expect(other.documentHash).not.toBe(first.documentHash);
  });

  it('cuts a value past what an answer keeps whole', async () => {
    const run = await tryRun({
      document: echo(`return 'x'.repeat(${VALUE_BYTES_MAX + 10_000});`),
      store,
    });
    expect(run.status).toBe('success');
    expect(typeof run.output).toBe('string');
    expect((run.output as string).length).toBeLessThan(VALUE_BYTES_MAX);
    expect(run.output as string).toMatch(/chars\)$/);
  });
});

describe('runTestsByHand', () => {
  it('answers an empty report for a document without tests', async () => {
    expect(
      await runTestsByHand({
        document: echo("return 'hi';"),
        detail: true,
        store,
      }),
    ).toEqual({ passed: 0, failed: 0, results: [] });
  });

  it("leaves out a test's run too large for the answer, and says so", async () => {
    const report = await runTestsByHand({
      document: {
        ...echo("return 'x'.repeat(600000);"),
        tests: [{ name: 'says a lot', input: {} }],
      },
      detail: true,
      store,
    });
    expect(report.passed).toBe(1);
    expect(report.results[0]?.run).toBeUndefined();
    expect(report.results[0]?.detailOmitted).toBe(true);
  });
});
