/**
 * Pass/fail thresholds over a run's summary, in the shape k6 users know.
 *
 * A thresholds file maps `<metric>.<stat>` to one expression or a list of
 * them:
 *
 *   { "http.p95": "<800", "errors.errorRate": "<=0.01",
 *     "chat.ttft.p99": ["<4000", ">0"], "sse.events.reconnects.count": "<100" }
 *
 * The stat is whatever follows the LAST dot, so metric names may themselves
 * contain dots and spaces (`GET /api/app/chat/threads.p95`). A metric is
 * `http` (every request timing merged), `errors` (every error recorded), a
 * timing name, a counter name or a gauge name. A threshold that cannot be
 * evaluated — an unknown metric, a stat the metric does not have, a
 * percentile of nothing — fails with a reason; it never passes silently.
 */

import { z } from 'zod';

import type { MetricsSummary, TimingRow } from './registry.ts';

export const THRESHOLD_STATS = [
  'count',
  'rate',
  'mean',
  'p50',
  'p90',
  'p95',
  'p99',
  'max',
  'errorRate',
] as const;

export type ThresholdStat = (typeof THRESHOLD_STATS)[number];

export type ThresholdOperator = '<' | '<=' | '>' | '>=' | '==';

export interface Threshold {
  /** The key as written, e.g. `http.p95`. */
  key: string;
  metric: string;
  stat: ThresholdStat;
  /** The expression as written, e.g. `<800`. */
  expression: string;
  operator: ThresholdOperator;
  value: number;
}

export interface ThresholdResult {
  key: string;
  expression: string;
  /** The measured value, or `null` when it could not be measured. */
  actual: number | null;
  ok: boolean;
  /** Why the threshold could not be evaluated. */
  reason?: string;
}

const EXPRESSION =
  /^(<=|>=|==|<|>)\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i;
const STATS: ReadonlySet<string> = new Set(THRESHOLD_STATS);

function splitKey(
  key: string,
): { metric: string; stat: ThresholdStat } | string {
  const dot = key.lastIndexOf('.');
  if (dot <= 0 || dot === key.length - 1) {
    return `"${key}" is not <metric>.<stat>`;
  }
  const stat = key.slice(dot + 1);
  if (!STATS.has(stat)) {
    return `"${key}": unknown stat "${stat}" (expected one of ${THRESHOLD_STATS.join(', ')})`;
  }
  return { metric: key.slice(0, dot), stat: stat as ThresholdStat };
}

function parseExpression(
  expression: string,
): { operator: ThresholdOperator; value: number } | null {
  const match = EXPRESSION.exec(expression.trim());
  if (match === null) {
    return null;
  }
  const value = Number(match[2]);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { operator: match[1] as ThresholdOperator, value };
}

/** The thresholds file: `<metric>.<stat>` to one expression or several. */
export const thresholdsSchema = z
  .record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))
  .superRefine((value, ctx) => {
    for (const [key, expressions] of Object.entries(value)) {
      const split = splitKey(key);
      if (typeof split === 'string') {
        ctx.addIssue({ code: 'custom', path: [key], message: split });
      }
      const list =
        typeof expressions === 'string' ? [expressions] : expressions;
      for (const expression of list) {
        if (parseExpression(expression) === null) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `"${expression}" is not <op><number> with op one of < <= > >= ==`,
          });
        }
      }
    }
  });

export type ThresholdsFile = z.infer<typeof thresholdsSchema>;

/**
 * Validate and flatten a thresholds file. Throws a `ZodError` naming every
 * malformed key and expression at once.
 */
export function parseThresholds(input: unknown): Threshold[] {
  const file = thresholdsSchema.parse(input);
  const thresholds: Threshold[] = [];
  for (const [key, expressions] of Object.entries(file)) {
    const split = splitKey(key);
    if (typeof split === 'string') {
      throw new Error(split);
    }
    const list = typeof expressions === 'string' ? [expressions] : expressions;
    for (const expression of list) {
      const parsed = parseExpression(expression);
      if (parsed === null) {
        throw new Error(`"${key}": malformed expression "${expression}"`);
      }
      thresholds.push({
        key,
        metric: split.metric,
        stat: split.stat,
        expression: expression.trim(),
        operator: parsed.operator,
        value: parsed.value,
      });
    }
  }
  return thresholds;
}

function compare(
  actual: number,
  operator: ThresholdOperator,
  value: number,
): boolean {
  switch (operator) {
    case '<':
      return actual < value;
    case '<=':
      return actual <= value;
    case '>':
      return actual > value;
    case '>=':
      return actual >= value;
    case '==':
      return actual === value;
  }
}

const NEEDS_SAMPLES: ReadonlySet<ThresholdStat> = new Set([
  'mean',
  'p50',
  'p90',
  'p95',
  'p99',
  'max',
  'errorRate',
]);

type Measured = { actual: number } | { reason: string };

function measureRow(row: TimingRow, stat: ThresholdStat): Measured {
  if (NEEDS_SAMPLES.has(stat) && row.count === 0) {
    return { reason: `"${row.name}" recorded no samples` };
  }
  return { actual: row[stat] };
}

function measure(summary: MetricsSummary, threshold: Threshold): Measured {
  const { metric, stat } = threshold;
  if (metric === 'http') {
    return measureRow(summary.http, stat);
  }
  if (metric === 'errors') {
    switch (stat) {
      case 'count':
        return { actual: summary.totals.errors };
      case 'rate':
        return { actual: summary.totals.errorsPerS };
      case 'errorRate':
        return summary.totals.requests > 0
          ? { actual: summary.totals.errorRate }
          : { reason: 'no requests were made, so there is no error rate' };
      default:
        return {
          reason: `"errors" has no stat "${stat}" (count, rate, errorRate)`,
        };
    }
  }
  const timing = summary.timings.find((candidate) => candidate.name === metric);
  if (timing !== undefined) {
    return measureRow(timing, stat);
  }
  const counter = summary.counters.find(
    (candidate) => candidate.name === metric,
  );
  if (counter !== undefined) {
    if (stat === 'count') {
      return { actual: counter.value };
    }
    if (stat === 'rate') {
      return { actual: counter.rate };
    }
    return {
      reason: `counter "${metric}" has no stat "${stat}" (count, rate)`,
    };
  }
  const gauge = summary.gauges.find((candidate) => candidate.name === metric);
  if (gauge !== undefined) {
    if (stat === 'max') {
      return { actual: gauge.max };
    }
    if (stat === 'count') {
      return { actual: gauge.current };
    }
    return {
      reason: `gauge "${metric}" has no stat "${stat}" (max, count = current)`,
    };
  }
  return {
    reason: `unknown metric "${metric}": nothing was recorded under that name`,
  };
}

/** Evaluate every threshold against a summary, in the order given. */
export function evaluateThresholds(
  thresholds: readonly Threshold[],
  summary: MetricsSummary,
): ThresholdResult[] {
  return thresholds.map((threshold) => {
    const measured = measure(summary, threshold);
    if ('reason' in measured) {
      return {
        key: threshold.key,
        expression: threshold.expression,
        actual: null,
        ok: false,
        reason: measured.reason,
      };
    }
    return {
      key: threshold.key,
      expression: threshold.expression,
      actual: measured.actual,
      ok: compare(measured.actual, threshold.operator, threshold.value),
    };
  });
}

/** One line per threshold: verdict, key, expression, actual or reason. */
export function formatThresholdResults(
  results: readonly ThresholdResult[],
): string {
  return results
    .map((result) => {
      const verdict = result.ok ? 'PASS' : 'FAIL';
      const actual =
        result.actual === null
          ? (result.reason ?? 'not measured')
          : `actual ${Number.isInteger(result.actual) ? result.actual : result.actual.toFixed(4)}`;
      return `${verdict}  ${result.key} ${result.expression}  (${actual})`;
    })
    .join('\n');
}
