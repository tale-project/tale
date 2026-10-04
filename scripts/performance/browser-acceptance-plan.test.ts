import { describe, expect, test } from 'bun:test';

import {
  acceptancePlan,
  inputToFrameMs,
  parseHostCpuPressure,
  summarizeAcceptance,
  type AcceptanceObservation,
} from './browser/acceptance-plan';

function observations(): AcceptanceObservation[] {
  return acceptancePlan.flatMap((block) =>
    block.samples.flatMap((sample) =>
      sample.operations.map((row) => ({
        ...row,
        durationMs: 100,
        heapMiB: 200,
        complete: true,
        valid: true,
      })),
    ),
  );
}

describe('immutable acceptance campaign', () => {
  test('declares both sizes, four groups, ABBA, one warmup and three samples', () => {
    expect(acceptancePlan).toHaveLength(32);
    expect(Object.isFrozen(acceptancePlan)).toBe(true);
    for (let index = 0; index < acceptancePlan.length; index += 4) {
      expect(
        acceptancePlan.slice(index, index + 4).map((block) => block.arm),
      ).toEqual(['baseline', 'candidate', 'candidate', 'baseline']);
    }
    for (const block of acceptancePlan) {
      expect(Object.isFrozen(block)).toBe(true);
      expect(Object.isFrozen(block.samples)).toBe(true);
      expect(block.samples.map((sample) => sample.sample)).toEqual([
        -1, 0, 1, 2,
      ]);
      for (const sample of block.samples) {
        expect(Object.isFrozen(sample)).toBe(true);
        expect(Object.isFrozen(sample.operations)).toBe(true);
        expect(sample.warmup).toBe(sample.sample === -1);
        expect(sample.operations.every(Object.isFrozen)).toBe(true);
      }
    }
    const rows = observations();
    expect(rows).toHaveLength(224);
    expect(new Set(rows.map((row) => row.id)).size).toBe(224);
    expect(rows.filter((row) => row.warmup)).toHaveLength(56);
    expect(rows.filter((row) => !row.warmup)).toHaveLength(168);
  });

  test('excludes every declared warmup and still requires independent review', () => {
    const rows = observations();
    for (const row of rows) if (row.warmup) row.durationMs = 100_000;
    const result = summarizeAcceptance(rows);
    expect(result.counts).toEqual({
      planned: 224,
      recorded: 224,
      warmup: 56,
      measured: 168,
      validMeasured: 168,
    });
    expect(result.rows).toEqual(rows);
    expect(result.summaries).toHaveLength(28);
    expect(
      result.summaries.every(
        (row) =>
          row.n === 6 &&
          row.median === 100 &&
          row.min === 100 &&
          row.max === 100,
      ),
    ).toBe(true);
    expect(result.pairedBlockDifferences).toHaveLength(28);
    expect(result.failures).toEqual([]);
    expect(result.verdict).toBe('inconclusive');
    expect(result.readyForIndependentReview).toBe(true);
    expect(result.requiresIndependentReview).toBe(true);
  });

  test('reports median, range and both adjacent ABBA block differences', () => {
    const rows = observations();
    for (const row of rows) {
      if (row.size !== 50 || row.operation !== 'cold' || row.warmup) continue;
      const starts = { 0: 10, 1: 15, 2: 35, 3: 40 };
      row.durationMs = starts[row.block] + row.sample * 10;
    }
    const result = summarizeAcceptance(rows);
    expect(
      result.summaries.find(
        (row) =>
          row.size === 50 && row.arm === 'baseline' && row.operation === 'cold',
      ),
    ).toMatchObject({ n: 6, median: 35, min: 10, max: 60 });
    const paired = result.pairedBlockDifferences.filter(
      (row) => row.size === 50 && row.operation === 'cold',
    );
    expect(
      paired.map((row) => [
        row.baselineBlock,
        row.candidateBlock,
        row.differenceMs,
      ]),
    ).toEqual([
      [0, 1, 5],
      [3, 2, -5],
    ]);
  });

  test('retains incomplete/invalid rows and missing coverage without invented measurements', () => {
    const rows = observations().slice(0, 8);
    const invalid = rows[1];
    expect(invalid).toBeDefined();
    if (!invalid) throw new Error('missing fixture');
    invalid.complete = false;
    invalid.valid = false;
    invalid.error = 'frame clock unavailable';
    delete invalid.durationMs;
    const result = summarizeAcceptance(rows);
    expect(result.rows).toEqual(rows);
    expect(result.invalidIds).toEqual([invalid.id]);
    expect(result.missingIds).toHaveLength(216);
    expect(result.coverageComplete).toBe(false);
    expect(result.readyForIndependentReview).toBe(false);
    expect(result.verdict).toBe('inconclusive');
    expect(
      result.summaries.find((row) => row.size === 2000)?.median,
    ).toBeNull();
    expect(
      result.pairedBlockDifferences.every((row) => row.differenceMs === null),
    ).toBe(true);
  });

  test('five valid rows do not replace the missing sixth declared observation', () => {
    const rows = observations().filter(
      (row) =>
        !(
          row.size === 50 &&
          row.operation === 'cold' &&
          row.block === 0 &&
          row.sample === 0
        ),
    );
    const result = summarizeAcceptance(rows);
    expect(
      result.summaries.find(
        (row) =>
          row.size === 50 && row.arm === 'baseline' && row.operation === 'cold',
      )?.n,
    ).toBe(5);
    expect(result.readyForIndependentReview).toBe(false);
    expect(result.missingIds).toHaveLength(1);
  });

  test('refuses duplicate, foreign, mismatched and reordered identities', () => {
    const rows = observations();
    const first = rows[0];
    if (!first) throw new Error('missing fixture');
    expect(() => summarizeAcceptance([first, first])).toThrow('Duplicate');
    expect(() =>
      summarizeAcceptance([{ ...first, id: 'replacement' }]),
    ).toThrow('Unknown');
    expect(() => summarizeAcceptance([{ ...first, arm: 'candidate' }])).toThrow(
      'Wrong arm',
    );
    expect(() => summarizeAcceptance(rows.toReversed())).toThrow(
      'Out-of-order',
    );
  });

  test.each([NaN, Infinity, -1])(
    'refuses a purportedly valid duration of %s',
    (durationMs) => {
      const row = observations()[0];
      if (!row) throw new Error('missing fixture');
      expect(() => summarizeAcceptance([{ ...row, durationMs }])).toThrow(
        'finite and nonnegative',
      );
    },
  );

  test('retains a valid slow result and does not replace it with a pass', () => {
    const rows = observations();
    const slow = rows.find(
      (row) =>
        row.arm === 'candidate' && row.operation === 'open' && !row.warmup,
    );
    if (!slow) throw new Error('missing fixture');
    slow.durationMs = 50_000;
    const result = summarizeAcceptance(rows);
    expect(result.coverageComplete).toBe(true);
    expect(result.counts.validMeasured).toBe(168);
    expect(result.rows.find((row) => row.id === slow.id)?.durationMs).toBe(
      50_000,
    );
    expect(
      result.failures.some(
        (failure) => failure.criterion === 'TASK-P4 open < 1000ms',
      ),
    ).toBe(true);
    expect(result.verdict).toBe('failed');
  });

  test('does not grant even a small positive protected median regression allowance', () => {
    const rows = observations();
    for (const row of rows)
      if (
        row.arm === 'candidate' &&
        row.size === 50 &&
        row.operation === 'search'
      )
        row.durationMs = 100.000001;
    expect(
      summarizeAcceptance(rows).failures.some(
        (failure) => failure.criterion === 'protected median regression',
      ),
    ).toBe(true);
  });

  test('reports a worse protected tail even when the candidate median improves', () => {
    const rows = observations();
    for (const row of rows)
      if (
        row.arm === 'candidate' &&
        row.size === 2000 &&
        row.operation === 'close' &&
        !row.warmup
      )
        row.durationMs = row.block === 2 && row.sample === 2 ? 900 : 50;
    const result = summarizeAcceptance(rows);
    expect(result.failures).toEqual([]);
    expect(result.tailWarnings).toContainEqual({
      size: 2000,
      operation: 'close',
    });
    expect(result.verdict).toBe('inconclusive');
  });

  test.each([
    [2000, 'search', 3000],
    [2000, 'leave', 3000],
    [2000, 'cold', 10000],
    [2000, 'nav', 10000],
    [2000, 'clear', 10000],
    [50, 'nav', 1100],
  ] as const)(
    'preserves inclusive median budget for %s/%s at %s ms',
    (size, operation, limit) => {
      const rows = observations();
      for (const row of rows)
        if (row.size === size && row.operation === operation)
          row.durationMs = limit;
      expect(summarizeAcceptance(rows).failures).toEqual([]);
      for (const row of rows)
        if (
          row.size === size &&
          row.operation === operation &&
          row.arm === 'candidate'
        )
          row.durationMs = limit + 0.01;
      expect(
        summarizeAcceptance(rows).failures.some(
          (failure) => failure.criterion === `median <= ${limit}ms`,
        ),
      ).toBe(true);
    },
  );

  test.each(['cold', 'nav'] as const)(
    'P1 applies to each 50-task %s observation, even when its median passes',
    (operation) => {
      const rows = observations();
      const row = rows.find(
        (item) =>
          item.size === 50 &&
          item.operation === operation &&
          item.arm === 'candidate' &&
          !item.warmup,
      );
      if (!row) throw new Error('missing fixture');
      row.durationMs = 3000;
      expect(
        summarizeAcceptance(rows).failures.some(
          (failure) => failure.criterion === 'TASK-P1 < 3000ms',
        ),
      ).toBe(true);
    },
  );

  test('requires after-load heap observations from both arms and keeps the 600 MiB cap', () => {
    const rows = observations();
    for (const row of rows) row.heapMiB = 600;
    expect(summarizeAcceptance(rows).failures).toEqual([]);
    const candidate = rows.find(
      (row) =>
        row.size === 2000 &&
        row.operation === 'cold' &&
        row.arm === 'candidate' &&
        !row.warmup,
    );
    const baseline = rows.find(
      (row) =>
        row.size === 2000 &&
        row.operation === 'nav' &&
        row.arm === 'baseline' &&
        !row.warmup,
    );
    if (!candidate || !baseline) throw new Error('missing fixture');
    candidate.heapMiB = 600.01;
    expect(
      summarizeAcceptance(rows).failures.some((failure) =>
        failure.criterion.startsWith('after-load heap'),
      ),
    ).toBe(true);
    candidate.heapMiB = 600;
    delete baseline.heapMiB;
    const missing = summarizeAcceptance(rows);
    expect(missing.missingHeapIds).toEqual([baseline.id]);
    expect(missing.readyForIndependentReview).toBe(false);
  });
});

describe('host pressure and input clocks', () => {
  const some = 'some avg10=19.99 avg60=1.25 avg300=0.00 total=1234';
  test('reads strict host PSI while retaining exact source text', () => {
    const raw = `${some}\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`;
    expect(parseHostCpuPressure(raw)).toEqual({ someAvg10: 19.99, raw });
    expect(parseHostCpuPressure(`${some}\n`).someAvg10).toBe(19.99);
  });
  test.each([
    '',
    'full avg10=0 avg60=0 avg300=0 total=0',
    `${some}\n${some}`,
    'some avg10=1 avg60=0 avg300=0',
    'some avg10=NaN avg60=0 avg300=0 total=0',
    'some avg10=101 avg60=0 avg300=0 total=0',
    'some avg10=-1 avg60=0 avg300=0 total=0',
    'some avg10=1 avg10=2 avg300=0 total=0',
    'some avg10=1 avg60=0 avg300=0 total=1.5',
    'some avg10=1 avg60=0 avg300=0 total=9007199254740992',
    `${some} other=0`,
    `${some}\nmalformed`,
  ])('refuses malformed/unavailable PSI: %s', (raw) => {
    expect(() => parseHostCpuPressure(raw)).toThrow();
  });
  test('selects the final matching native input/key, not another captured event', () => {
    const inputs = [
      { type: 'click', t: 1 },
      { type: 'keydown', key: 'Backspace', t: 4 },
      { type: 'keydown', key: 'z', t: 8 },
      { type: 'keydown', key: 'Backspace', t: 12 },
      { type: 'keyup', key: 'Backspace', t: 16 },
    ];
    expect(inputToFrameMs(inputs, 'keydown', 20, 'Backspace')).toBe(8);
    expect(inputToFrameMs(inputs, 'keydown', 20)).toBe(8);
    expect(inputToFrameMs(inputs, 'click', 20)).toBe(19);
    expect(() => inputToFrameMs(inputs, 'keydown', 20, 'Escape')).toThrow(
      'Missing',
    );
    expect(() => inputToFrameMs([], 'click', 20)).toThrow('Missing');
  });
  test.each([NaN, Infinity, -1])(
    'refuses invalid input/frame clock %s',
    (stamp) => {
      expect(() =>
        inputToFrameMs([{ type: 'click', t: stamp }], 'click', 20),
      ).toThrow();
      expect(() =>
        inputToFrameMs([{ type: 'click', t: 1 }], 'click', stamp),
      ).toThrow();
    },
  );
  test('refuses a negative matching-clock delta rather than clamping to zero', () => {
    expect(() =>
      inputToFrameMs([{ type: 'click', t: 21 }], 'click', 20),
    ).toThrow('input-to-frame delta');
  });
});
