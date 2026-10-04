import assert from 'node:assert/strict';

export type AcceptanceSize = 50 | 2000;
export type AcceptanceArm = 'baseline' | 'candidate';
export type AcceptanceGroup = 'cold' | 'navLeave' | 'searchClear' | 'dialog';
export type AcceptanceOperation =
  | 'cold'
  | 'nav'
  | 'leave'
  | 'search'
  | 'clear'
  | 'open'
  | 'close';

export interface AcceptancePlannedRow {
  id: string;
  size: AcceptanceSize;
  group: AcceptanceGroup;
  block: 0 | 1 | 2 | 3;
  arm: AcceptanceArm;
  sample: -1 | 0 | 1 | 2;
  warmup: boolean;
  operation: AcceptanceOperation;
}

export interface AcceptanceBlock {
  size: AcceptanceSize;
  group: AcceptanceGroup;
  block: AcceptancePlannedRow['block'];
  arm: AcceptanceArm;
  samples: readonly {
    sample: AcceptancePlannedRow['sample'];
    warmup: boolean;
    operations: readonly AcceptancePlannedRow[];
  }[];
}

export interface AcceptanceObservation extends AcceptancePlannedRow {
  durationMs?: number;
  heapMiB?: number;
  complete: boolean;
  valid: boolean;
  error?: string;
}

const sizes = [50, 2000] as const;
const groups = ['cold', 'navLeave', 'searchClear', 'dialog'] as const;
const operations: Record<AcceptanceGroup, readonly AcceptanceOperation[]> = {
  cold: ['cold'],
  navLeave: ['nav', 'leave'],
  searchClear: ['search', 'clear'],
  dialog: ['open', 'close'],
};
const arms = ['baseline', 'candidate', 'candidate', 'baseline'] as const;
const blocks = [0, 1, 2, 3] as const;
const samples = [-1, 0, 1, 2] as const;
const allOperations = Object.values(operations).flat();

/** One declared warmup and three measurements per ABBA block. Nested plan
 * values are frozen so a failed/slow sample cannot be replaced or reordered. */
export const acceptancePlan: readonly AcceptanceBlock[] = Object.freeze(
  sizes.flatMap((size) =>
    groups.flatMap((group) =>
      blocks.map((block) => {
        const arm = arms[block];
        return Object.freeze({
          size,
          group,
          block,
          arm,
          samples: Object.freeze(
            samples.map((sample) => {
              const warmup = sample === -1;
              return Object.freeze({
                sample,
                warmup,
                operations: Object.freeze(
                  operations[group].map((operation) =>
                    Object.freeze({
                      id: `${size}/${group}/${block}/${arm}/${sample}/${operation}`,
                      size,
                      group,
                      block,
                      arm,
                      sample,
                      warmup,
                      operation,
                    }),
                  ),
                ),
              });
            }),
          ),
        });
      }),
    ),
  ),
);

const plannedRows = acceptancePlan.flatMap((block) =>
  block.samples.flatMap((sample) => sample.operations),
);
const byId = new Map(plannedRows.map((row) => [row.id, row]));
const identity = [
  'size',
  'group',
  'block',
  'arm',
  'sample',
  'warmup',
  'operation',
] as const;

function nonnegative(value: unknown, name: string): asserts value is number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
    `${name} must be finite and nonnegative`,
  );
}

function distribution(values: readonly number[]) {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  let median: number | null = null;
  if (upper !== undefined) {
    if (sorted.length % 2 === 1) median = upper;
    else {
      assert(lower !== undefined);
      median = lower + (upper - lower) / 2;
    }
  }
  return {
    n: sorted.length,
    median,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}

function measured(rows: readonly AcceptanceObservation[]) {
  return rows.filter((row) => !row.warmup && row.complete && row.valid);
}

/** Summaries never confer acceptance: complete numerical evidence still
 * needs independent functional, animation and non-regression review. */
export function summarizeAcceptance(rows: readonly AcceptanceObservation[]) {
  const seen = new Set<string>();
  let previousOrdinal = -1;
  for (const row of rows) {
    const expected = byId.get(row.id);
    assert(expected, `Unknown acceptance row ${row.id}`);
    assert(!seen.has(row.id), `Duplicate acceptance row ${row.id}`);
    seen.add(row.id);
    const ordinal = plannedRows.indexOf(expected);
    assert(ordinal > previousOrdinal, 'Out-of-order acceptance row');
    previousOrdinal = ordinal;
    for (const key of identity)
      assert.equal(row[key], expected[key], `Wrong ${key} for ${row.id}`);
    assert.equal(typeof row.complete, 'boolean', 'Missing completion state');
    assert.equal(typeof row.valid, 'boolean', 'Missing validity state');
    assert(!row.valid || row.complete, 'A valid row must be complete');
    if (row.complete && row.valid) {
      nonnegative(row.durationMs, 'durationMs');
      if (row.heapMiB !== undefined) nonnegative(row.heapMiB, 'heapMiB');
    } else {
      assert(row.error?.trim(), 'Invalid/incomplete rows need a reason');
    }
  }
  const valid = measured(rows);
  const durations = (selected: readonly AcceptanceObservation[]) =>
    selected.map((row) => {
      nonnegative(row.durationMs, 'durationMs');
      return row.durationMs;
    });
  const summaries = sizes.flatMap((size) =>
    (['baseline', 'candidate'] as const).flatMap((arm) =>
      allOperations.map((operation) => ({
        size,
        arm,
        operation,
        ...distribution(
          durations(
            valid.filter(
              (row) =>
                row.size === size &&
                row.arm === arm &&
                row.operation === operation,
            ),
          ),
        ),
      })),
    ),
  );
  const pairedBlockDifferences = sizes.flatMap((size) =>
    allOperations.flatMap((operation) =>
      (
        [
          { baseline: 0, candidate: 1 },
          { baseline: 3, candidate: 2 },
        ] as const
      ).map((pair) => {
        const side = (block: number) =>
          distribution(
            durations(
              valid.filter(
                (row) =>
                  row.size === size &&
                  row.operation === operation &&
                  row.block === block,
              ),
            ),
          );
        const baseline = side(pair.baseline);
        const candidate = side(pair.candidate);
        return {
          size,
          operation,
          baselineBlock: pair.baseline,
          candidateBlock: pair.candidate,
          baseline,
          candidate,
          differenceMs:
            baseline.n === 3 &&
            candidate.n === 3 &&
            baseline.median !== null &&
            candidate.median !== null
              ? candidate.median - baseline.median
              : null,
        };
      }),
    ),
  );
  const failures: { criterion: string; ids: string[] }[] = [];
  const tailWarnings: {
    size: AcceptanceSize;
    operation: AcceptanceOperation;
  }[] = [];
  for (const candidate of summaries.filter((row) => row.arm === 'candidate')) {
    const baseline = summaries.find(
      (row) =>
        row.arm === 'baseline' &&
        row.size === candidate.size &&
        row.operation === candidate.operation,
    );
    assert(baseline);
    const selected = valid.filter(
      (row) =>
        row.arm === 'candidate' &&
        row.size === candidate.size &&
        row.operation === candidate.operation,
    );
    const protectedFlow =
      candidate.size === 50 || ['open', 'close'].includes(candidate.operation);
    if (
      protectedFlow &&
      candidate.n >= 5 &&
      baseline.n >= 5 &&
      candidate.median !== null &&
      baseline.median !== null &&
      candidate.median > baseline.median
    ) {
      failures.push({
        criterion: 'protected median regression',
        ids: selected.map((row) => row.id),
      });
    }
    if (
      protectedFlow &&
      candidate.max !== null &&
      baseline.max !== null &&
      candidate.max > baseline.max
    )
      tailWarnings.push({
        size: candidate.size,
        operation: candidate.operation,
      });
    const medianLimit =
      candidate.size === 50
        ? candidate.operation === 'nav'
          ? 1100
          : undefined
        : ['search', 'leave'].includes(candidate.operation)
          ? 3000
          : ['cold', 'nav', 'clear'].includes(candidate.operation)
            ? 10000
            : undefined;
    if (
      candidate.n >= 5 &&
      candidate.median !== null &&
      medianLimit !== undefined &&
      candidate.median > medianLimit
    )
      failures.push({
        criterion: `median <= ${medianLimit}ms`,
        ids: selected.map((row) => row.id),
      });
  }
  const candidateRows = valid.filter((row) => row.arm === 'candidate');
  for (const row of candidateRows) {
    const duration = row.durationMs;
    nonnegative(duration, 'durationMs');
    if (
      row.size === 50 &&
      ['cold', 'nav'].includes(row.operation) &&
      duration >= 3000
    )
      failures.push({ criterion: 'TASK-P1 < 3000ms', ids: [row.id] });
    if (row.operation === 'open' && duration >= 1000)
      failures.push({ criterion: 'TASK-P4 open < 1000ms', ids: [row.id] });
    if (
      row.size === 2000 &&
      ['cold', 'nav'].includes(row.operation) &&
      row.heapMiB !== undefined &&
      row.heapMiB > 600
    )
      failures.push({
        criterion: 'after-load heap <= 600MiB (historical MB label)',
        ids: [row.id],
      });
  }
  const missingHeapIds = valid
    .filter(
      (row) =>
        row.size === 2000 &&
        ['cold', 'nav'].includes(row.operation) &&
        row.heapMiB === undefined,
    )
    .map((row) => row.id);
  const missingIds = plannedRows
    .filter((row) => !seen.has(row.id))
    .map((row) => row.id);
  const invalidIds = rows
    .filter((row) => !row.complete || !row.valid)
    .map((row) => row.id);
  const coverageComplete = missingIds.length === 0 && invalidIds.length === 0;
  return {
    rows: [...rows],
    counts: {
      planned: plannedRows.length,
      recorded: rows.length,
      warmup: rows.filter((row) => row.warmup).length,
      measured: rows.filter((row) => !row.warmup).length,
      validMeasured: valid.length,
    },
    missingIds,
    invalidIds,
    missingHeapIds,
    coverageComplete,
    summaries,
    pairedBlockDifferences,
    failures,
    tailWarnings,
    verdict:
      failures.length > 0 ? ('failed' as const) : ('inconclusive' as const),
    readyForIndependentReview:
      coverageComplete && missingHeapIds.length === 0 && failures.length === 0,
    requiresIndependentReview: true as const,
  };
}

/** Keep the source text alongside the host (not cgroup) PSI gate value. */
export function parseHostCpuPressure(text: string) {
  const lines = text.trim().split(/\n/);
  const records = new Map<string, number>();
  for (const line of lines) {
    const [kind, ...fields] = line.trim().split(/\s+/);
    assert(kind === 'some' || kind === 'full', 'Unknown CPU PSI record');
    assert(!records.has(kind), 'Duplicate CPU PSI record');
    assert.equal(fields.length, 4, 'Incomplete CPU PSI record');
    const values = new Map<string, number>();
    for (const field of fields) {
      const match =
        /^(avg10|avg60|avg300|total)=((?:0|[1-9]\d*)(?:\.\d+)?)$/.exec(field);
      assert(match, 'Malformed CPU PSI field');
      const key = match[1];
      const raw = match[2];
      assert(key !== undefined && raw !== undefined);
      assert(!values.has(key), 'Duplicate CPU PSI field');
      const value = Number(raw);
      nonnegative(value, 'CPU PSI value');
      if (key === 'total')
        assert(
          /^\d+$/.test(raw) && Number.isSafeInteger(value),
          'Invalid CPU PSI total',
        );
      else assert(value <= 100, 'CPU PSI percentage exceeds 100');
      values.set(key, value);
    }
    for (const key of ['avg10', 'avg60', 'avg300', 'total'])
      assert(values.has(key), 'Missing CPU PSI field');
    const avg10 = values.get('avg10');
    assert(avg10 !== undefined);
    records.set(kind, avg10);
  }
  const someAvg10 = records.get('some');
  assert(someAvg10 !== undefined, 'Missing CPU PSI some record');
  return { someAvg10, raw: text };
}

export function inputToFrameMs(
  inputs: readonly { type: string; t: number; key?: string | null }[],
  expectedType: string,
  frame: number,
  expectedKey?: string,
) {
  assert(expectedType.length > 0, 'An input type is required');
  nonnegative(frame, 'frame timestamp');
  for (const input of inputs) nonnegative(input.t, 'input timestamp');
  const input = inputs.findLast(
    (event) =>
      event.type === expectedType &&
      (expectedKey === undefined || event.key === expectedKey),
  );
  assert(input, 'Missing intended input');
  const duration = frame - input.t;
  nonnegative(duration, 'input-to-frame delta');
  return duration;
}
