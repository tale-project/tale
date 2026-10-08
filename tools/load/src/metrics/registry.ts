/**
 * The metrics every virtual user records into, one registry per process.
 *
 * Recording is the hot path: tens of thousands of users share one registry,
 * so a record is a map lookup and a histogram increment, never an
 * allocation. Everything expensive — encoding histograms, merging shards,
 * computing percentiles — happens in `snapshot`, `mergeSnapshots` and
 * `summarize`, which run every few seconds at most.
 *
 * A snapshot is plain JSON: histograms travel encoded, so a coordinator can
 * merge the snapshots of every shard into exact percentiles.
 */

import { z } from 'zod';

import { LatencyHistogram, mergeEncoded } from './histogram.ts';

/** Which shard of a distributed run produced a snapshot. */
export interface ShardInfo {
  index: number;
  count: number;
  /** Free-form origin, e.g. the generator's host name. */
  label?: string;
}

/**
 * `request` timings are HTTP round trips (the `http` aggregate and the
 * per-window request counts draw on them); `timing` is any other duration,
 * such as a chat turn's time to first token.
 */
export type TimingKind = 'request' | 'timing';

export interface TimingSnapshot {
  kind: TimingKind;
  /** `LatencyHistogram.encode()` output. */
  histogram: string;
}

export interface GaugeSnapshot {
  current: number;
  /**
   * Peak value. After a merge this is the sum of every shard's peak, an upper
   * bound: shards need not peak at the same moment.
   */
  max: number;
}

export interface ErrorSnapshot {
  count: number;
  /** The most recent details, oldest first, at most `ERROR_SAMPLES`. */
  samples: string[];
}

/** One window of the rolling time series. */
export interface SeriesWindowSnapshot {
  /** Window start, epoch milliseconds, aligned to the window length. */
  start: number;
  requests: number;
  errors: number;
  /** Request latency within the window, encoded; `null` when none ran. */
  latency: string | null;
  /** Each `chat.ttft*` timing within the window, encoded, by name. */
  ttft: Record<string, string>;
}

export interface MetricsSnapshot {
  version: 1;
  /** Epoch milliseconds the registry (or the earliest merged one) started. */
  startedAt: number;
  /** Epoch milliseconds the snapshot was taken (latest, after a merge). */
  endedAt: number;
  windowMs: number;
  /** Shards folded into this snapshot; empty when the registry had none. */
  shards: ShardInfo[];
  timings: Record<string, TimingSnapshot>;
  counters: Record<string, number>;
  gauges: Record<string, GaugeSnapshot>;
  /** Response status counts per metric name; status `0` is a network failure. */
  statuses: Record<string, Record<string, number>>;
  /** Errors per metric name, then per error kind. */
  errors: Record<string, Record<string, ErrorSnapshot>>;
  series: SeriesWindowSnapshot[];
}

const shardInfoSchema = z.object({
  index: z.number().int().min(0),
  count: z.number().int().min(1),
  label: z.string().optional(),
});

/** Validates a snapshot received from another process. */
export const metricsSnapshotSchema = z.object({
  version: z.literal(1),
  startedAt: z.number(),
  endedAt: z.number(),
  windowMs: z.number().int().positive(),
  shards: z.array(shardInfoSchema),
  timings: z.record(
    z.string(),
    z.object({ kind: z.enum(['request', 'timing']), histogram: z.string() }),
  ),
  counters: z.record(z.string(), z.number()),
  gauges: z.record(
    z.string(),
    z.object({ current: z.number(), max: z.number() }),
  ),
  statuses: z.record(z.string(), z.record(z.string(), z.number())),
  errors: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({ count: z.number(), samples: z.array(z.string()) }),
    ),
  ),
  series: z.array(
    z.object({
      start: z.number(),
      requests: z.number(),
      errors: z.number(),
      latency: z.string().nullable(),
      ttft: z.record(z.string(), z.string()),
    }),
  ),
});

/** Samples kept per (metric name, error kind). */
export const ERROR_SAMPLES = 5;
/** Longest error detail kept, in characters. */
export const ERROR_DETAIL_MAX = 300;
/** Default length of one time-series window. */
export const DEFAULT_WINDOW_MS = 5_000;
/** Default span of time-series history kept: two hours. */
export const DEFAULT_RETENTION_MS = 2 * 60 * 60 * 1000;

/** Window histograms trade a digit of precision for a sixth of the memory. */
const WINDOW_DIGITS = 2;
const TTFT_PREFIX = 'chat.ttft';

export interface MetricsRegistryOptions {
  shard?: ShardInfo;
  /** Clock in epoch milliseconds; injectable so tests control windows. */
  now?: () => number;
  windowMs?: number;
  retentionMs?: number;
}

interface TimingEntry {
  histogram: LatencyHistogram;
  kind: TimingKind;
  /** Cached `name.startsWith('chat.ttft')`, so recording never re-checks. */
  ttft: boolean;
}

interface ErrorEntry {
  count: number;
  samples: string[];
  /** Ring cursor: the slot the next sample overwrites once the ring is full. */
  next: number;
}

interface OpenWindow {
  start: number;
  requests: number;
  errors: number;
  latency: LatencyHistogram | null;
  ttft: Map<string, LatencyHistogram>;
}

interface ClosedWindow extends SeriesWindowSnapshot {
  p50: number;
  p95: number;
  p99: number;
}

/** The last completed window, for a live progress line. */
export interface RecentWindow {
  start: number;
  requests: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
}

function truncateDetail(detail: string): string {
  return detail.length > ERROR_DETAIL_MAX
    ? `${detail.slice(0, ERROR_DETAIL_MAX - 1)}…`
    : detail;
}

function ringInOrder(entry: ErrorEntry): string[] {
  if (entry.samples.length < ERROR_SAMPLES) {
    return entry.samples.slice();
  }
  const start = entry.next % ERROR_SAMPLES;
  return [...entry.samples.slice(start), ...entry.samples.slice(0, start)];
}

export class MetricsRegistry {
  readonly #now: () => number;
  readonly #windowMs: number;
  readonly #retentionMs: number;
  readonly #shard: ShardInfo | undefined;
  readonly #startedAt: number;

  readonly #timings = new Map<string, TimingEntry>();
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, { current: number; max: number }>();
  readonly #statuses = new Map<string, Map<number, number>>();
  readonly #errors = new Map<string, Map<string, ErrorEntry>>();

  #requests = 0;
  #errorTotal = 0;
  #window: OpenWindow;
  readonly #closed: ClosedWindow[] = [];
  /** Reset window histograms, reused so a new window allocates nothing. */
  readonly #pool: LatencyHistogram[] = [];

  constructor(options: MetricsRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.#retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.#shard = options.shard;
    this.#startedAt = this.#now();
    this.#window = this.#emptyWindow(this.#windowStart(this.#startedAt));
  }

  /** Record a duration under `name`. */
  timing(name: string, ms: number): void {
    const entry = this.#timing(name, 'timing');
    entry.histogram.record(ms);
    if (entry.ttft) {
      this.#recordTtft(name, ms);
    }
  }

  /**
   * Record one HTTP round trip: its duration, its status (`0` for a network
   * failure) and its share of the current window's request count and
   * latency. Errors are recorded separately through `error`.
   */
  request(name: string, ms: number, status: number): void {
    const entry = this.#timing(name, 'request');
    entry.kind = 'request';
    entry.histogram.record(ms);
    this.status(name, status);
    this.#requests += 1;
    const window = this.#current();
    window.requests += 1;
    window.latency ??= this.#borrow();
    window.latency.record(ms);
    if (entry.ttft) {
      this.#recordTtft(name, ms);
    }
  }

  /** Add `n` to the counter `name`. */
  counter(name: string, n = 1): void {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + n);
  }

  /** Move the gauge `name` by `delta`, tracking its peak. */
  gauge(name: string, delta: number): void {
    let entry = this.#gauges.get(name);
    if (entry === undefined) {
      entry = { current: 0, max: 0 };
      this.#gauges.set(name, entry);
    }
    entry.current += delta;
    if (entry.current > entry.max) {
      entry.max = entry.current;
    }
  }

  /** Count one response with status `code` under `name`. */
  status(name: string, code: number): void {
    let codes = this.#statuses.get(name);
    if (codes === undefined) {
      codes = new Map();
      this.#statuses.set(name, codes);
    }
    codes.set(code, (codes.get(code) ?? 0) + 1);
  }

  /**
   * Count one error of `kind` under `name`, keeping the latest few details
   * so a report can show what actually came back.
   */
  error(name: string, kind: string, detail?: string): void {
    let kinds = this.#errors.get(name);
    if (kinds === undefined) {
      kinds = new Map();
      this.#errors.set(name, kinds);
    }
    let entry = kinds.get(kind);
    if (entry === undefined) {
      entry = { count: 0, samples: [], next: 0 };
      kinds.set(kind, entry);
    }
    entry.count += 1;
    if (detail !== undefined && detail !== '') {
      const sample = truncateDetail(detail);
      if (entry.samples.length < ERROR_SAMPLES) {
        entry.samples.push(sample);
      } else {
        entry.samples[entry.next % ERROR_SAMPLES] = sample;
      }
      entry.next += 1;
    }
    this.#errorTotal += 1;
    this.#current().errors += 1;
  }

  /** The live histogram of `name`, or `undefined` when nothing was recorded. */
  histogram(name: string): LatencyHistogram | undefined {
    return this.#timings.get(name)?.histogram;
  }

  counterValue(name: string): number {
    return this.#counters.get(name) ?? 0;
  }

  gaugeValue(name: string): { current: number; max: number } | undefined {
    const entry = this.#gauges.get(name);
    return entry === undefined ? undefined : { ...entry };
  }

  /** Errors under `name` (every kind, or just `kind`). */
  errorCount(name: string, kind?: string): number {
    const kinds = this.#errors.get(name);
    if (kinds === undefined) {
      return 0;
    }
    if (kind !== undefined) {
      return kinds.get(kind)?.count ?? 0;
    }
    let total = 0;
    for (const entry of kinds.values()) {
      total += entry.count;
    }
    return total;
  }

  /** Requests and errors recorded since the registry started. */
  totals(): { requests: number; errors: number } {
    return { requests: this.#requests, errors: this.#errorTotal };
  }

  /** The most recent completed window, or `null` before the first closes. */
  recent(): RecentWindow | null {
    this.#current();
    const last = this.#closed.at(-1);
    if (last === undefined) {
      return null;
    }
    return {
      start: last.start,
      requests: last.requests,
      errors: last.errors,
      p50: last.p50,
      p95: last.p95,
      p99: last.p99,
    };
  }

  /**
   * A JSON-safe copy of everything recorded so far. `seriesSince` keeps only
   * windows starting at or after that epoch millisecond, so a periodic report
   * ships the recent windows instead of two hours of history every time; the
   * receiver then keeps the history it has already seen. Include the still
   * open window's start again next time: it keeps filling until it closes.
   */
  snapshot(options: { seriesSince?: number } = {}): MetricsSnapshot {
    const endedAt = this.#now();
    const open = this.#current();
    const since = options.seriesSince ?? Number.NEGATIVE_INFINITY;
    const series: SeriesWindowSnapshot[] = [];
    for (const window of this.#closed) {
      if (window.start >= since) {
        series.push({
          start: window.start,
          requests: window.requests,
          errors: window.errors,
          latency: window.latency,
          ttft: window.ttft,
        });
      }
    }
    if (open.start >= since && !this.#isIdle(open)) {
      series.push(this.#encodeWindow(open));
    }
    return {
      version: 1,
      startedAt: this.#startedAt,
      endedAt,
      windowMs: this.#windowMs,
      shards: this.#shard === undefined ? [] : [{ ...this.#shard }],
      timings: Object.fromEntries(
        Array.from(this.#timings, ([name, entry]) => [
          name,
          { kind: entry.kind, histogram: entry.histogram.encode() },
        ]),
      ),
      counters: Object.fromEntries(this.#counters),
      gauges: Object.fromEntries(
        Array.from(this.#gauges, ([name, entry]) => [name, { ...entry }]),
      ),
      statuses: Object.fromEntries(
        Array.from(this.#statuses, ([name, codes]) => [
          name,
          Object.fromEntries(
            Array.from(codes, ([code, count]) => [String(code), count]),
          ),
        ]),
      ),
      errors: Object.fromEntries(
        Array.from(this.#errors, ([name, kinds]) => [
          name,
          Object.fromEntries(
            Array.from(kinds, ([kind, entry]) => [
              kind,
              { count: entry.count, samples: ringInOrder(entry) },
            ]),
          ),
        ]),
      ),
      series,
    };
  }

  #timing(name: string, kind: TimingKind): TimingEntry {
    let entry = this.#timings.get(name);
    if (entry === undefined) {
      entry = {
        histogram: new LatencyHistogram(),
        kind,
        ttft: name.startsWith(TTFT_PREFIX),
      };
      this.#timings.set(name, entry);
    }
    return entry;
  }

  #recordTtft(name: string, ms: number): void {
    const window = this.#current();
    let histogram = window.ttft.get(name);
    if (histogram === undefined) {
      histogram = this.#borrow();
      window.ttft.set(name, histogram);
    }
    histogram.record(ms);
  }

  #windowStart(at: number): number {
    return Math.floor(at / this.#windowMs) * this.#windowMs;
  }

  #emptyWindow(start: number): OpenWindow {
    return { start, requests: 0, errors: 0, latency: null, ttft: new Map() };
  }

  #isIdle(window: OpenWindow): boolean {
    return (
      window.requests === 0 &&
      window.errors === 0 &&
      window.latency === null &&
      window.ttft.size === 0
    );
  }

  #borrow(): LatencyHistogram {
    return (
      this.#pool.pop() ??
      new LatencyHistogram({ significantDigits: WINDOW_DIGITS })
    );
  }

  /**
   * The window the clock is in now, closing the previous one when the clock
   * crossed a boundary. A clock that steps backwards keeps the open window.
   */
  #current(): OpenWindow {
    const start = this.#windowStart(this.#now());
    if (start <= this.#window.start) {
      return this.#window;
    }
    const previous = this.#window;
    if (!this.#isIdle(previous)) {
      const encoded = this.#encodeWindow(previous);
      this.#closed.push({
        ...encoded,
        p50: previous.latency?.percentile(50) ?? 0,
        p95: previous.latency?.percentile(95) ?? 0,
        p99: previous.latency?.percentile(99) ?? 0,
      });
      this.#release(previous);
    }
    const horizon = start - this.#retentionMs;
    let drop = 0;
    while (drop < this.#closed.length && this.#closed[drop].start < horizon) {
      drop += 1;
    }
    if (drop > 0) {
      this.#closed.splice(0, drop);
    }
    this.#window = this.#emptyWindow(start);
    return this.#window;
  }

  #encodeWindow(window: OpenWindow): SeriesWindowSnapshot {
    return {
      start: window.start,
      requests: window.requests,
      errors: window.errors,
      latency: window.latency?.encode() ?? null,
      ttft: Object.fromEntries(
        Array.from(window.ttft, ([name, histogram]) => [
          name,
          histogram.encode(),
        ]),
      ),
    };
  }

  #release(window: OpenWindow): void {
    if (window.latency !== null) {
      window.latency.reset();
      this.#pool.push(window.latency);
    }
    for (const histogram of window.ttft.values()) {
      histogram.reset();
      this.#pool.push(histogram);
    }
  }
}

/**
 * Fold the snapshots of several shards into one. Histograms merge exactly;
 * counters, statuses and errors add; error samples keep the first few seen.
 * Every total in a snapshot is cumulative since its registry started, so
 * pass each shard's LATEST snapshot once — two reports of the same shard
 * would count its requests twice. Throws on an empty list or on snapshots
 * with different window lengths.
 */
export function mergeSnapshots(
  snapshots: readonly MetricsSnapshot[],
): MetricsSnapshot {
  const first = snapshots[0];
  if (first === undefined) {
    throw new Error('mergeSnapshots needs at least one snapshot');
  }
  for (const snapshot of snapshots) {
    if (snapshot.windowMs !== first.windowMs) {
      throw new Error(
        `cannot merge snapshots with window lengths ${first.windowMs} and ${snapshot.windowMs}`,
      );
    }
  }

  const timings = new Map<string, { kind: TimingKind; encoded: string[] }>();
  const counters = new Map<string, number>();
  const gauges = new Map<string, GaugeSnapshot>();
  const statuses = new Map<string, Map<string, number>>();
  const errors = new Map<string, Map<string, ErrorSnapshot>>();
  const windows = new Map<
    number,
    {
      requests: number;
      errors: number;
      latency: string[];
      ttft: Map<string, string[]>;
    }
  >();
  const shards: ShardInfo[] = [];
  let startedAt = Number.POSITIVE_INFINITY;
  let endedAt = Number.NEGATIVE_INFINITY;

  for (const snapshot of snapshots) {
    startedAt = Math.min(startedAt, snapshot.startedAt);
    endedAt = Math.max(endedAt, snapshot.endedAt);
    for (const shard of snapshot.shards) {
      shards.push({ ...shard });
    }
    for (const [name, timing] of Object.entries(snapshot.timings)) {
      const entry = timings.get(name);
      if (entry === undefined) {
        timings.set(name, { kind: timing.kind, encoded: [timing.histogram] });
      } else {
        entry.encoded.push(timing.histogram);
        if (timing.kind === 'request') {
          entry.kind = 'request';
        }
      }
    }
    for (const [name, value] of Object.entries(snapshot.counters)) {
      counters.set(name, (counters.get(name) ?? 0) + value);
    }
    for (const [name, gauge] of Object.entries(snapshot.gauges)) {
      const entry = gauges.get(name);
      gauges.set(
        name,
        entry === undefined
          ? { ...gauge }
          : {
              current: entry.current + gauge.current,
              max: entry.max + gauge.max,
            },
      );
    }
    for (const [name, codes] of Object.entries(snapshot.statuses)) {
      let merged = statuses.get(name);
      if (merged === undefined) {
        merged = new Map();
        statuses.set(name, merged);
      }
      for (const [code, count] of Object.entries(codes)) {
        merged.set(code, (merged.get(code) ?? 0) + count);
      }
    }
    for (const [name, kinds] of Object.entries(snapshot.errors)) {
      let merged = errors.get(name);
      if (merged === undefined) {
        merged = new Map();
        errors.set(name, merged);
      }
      for (const [kind, entry] of Object.entries(kinds)) {
        const existing = merged.get(kind);
        if (existing === undefined) {
          merged.set(kind, {
            count: entry.count,
            samples: entry.samples.slice(0, ERROR_SAMPLES),
          });
        } else {
          existing.count += entry.count;
          for (const sample of entry.samples) {
            if (existing.samples.length >= ERROR_SAMPLES) {
              break;
            }
            existing.samples.push(sample);
          }
        }
      }
    }
    for (const window of snapshot.series) {
      let merged = windows.get(window.start);
      if (merged === undefined) {
        merged = { requests: 0, errors: 0, latency: [], ttft: new Map() };
        windows.set(window.start, merged);
      }
      merged.requests += window.requests;
      merged.errors += window.errors;
      if (window.latency !== null) {
        merged.latency.push(window.latency);
      }
      for (const [name, encoded] of Object.entries(window.ttft)) {
        const list = merged.ttft.get(name);
        if (list === undefined) {
          merged.ttft.set(name, [encoded]);
        } else {
          list.push(encoded);
        }
      }
    }
  }

  const windowOptions = { significantDigits: WINDOW_DIGITS } as const;
  const series: SeriesWindowSnapshot[] = Array.from(windows)
    .sort(([a], [b]) => a - b)
    .map(([start, window]) => ({
      start,
      requests: window.requests,
      errors: window.errors,
      latency: mergeEncoded(window.latency, windowOptions)?.encode() ?? null,
      ttft: Object.fromEntries(
        Array.from(window.ttft, ([name, list]) => [
          name,
          mergeEncoded(list, windowOptions)?.encode() ?? '',
        ]),
      ),
    }));

  return {
    version: 1,
    startedAt,
    endedAt,
    windowMs: first.windowMs,
    shards,
    timings: Object.fromEntries(
      Array.from(timings, ([name, entry]) => [
        name,
        {
          kind: entry.kind,
          histogram: mergeEncoded(entry.encoded)?.encode() ?? '',
        },
      ]),
    ),
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
    statuses: Object.fromEntries(
      Array.from(statuses, ([name, codes]) => [
        name,
        Object.fromEntries(codes),
      ]),
    ),
    errors: Object.fromEntries(
      Array.from(errors, ([name, kinds]) => [name, Object.fromEntries(kinds)]),
    ),
    series,
  };
}

/** One line of the report: a timing's distribution and its error share. */
export interface TimingRow {
  name: string;
  kind: TimingKind;
  count: number;
  /** Samples per second over the snapshot's span. */
  rate: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  /** Errors recorded under the same name, every kind. */
  errors: number;
  /** `errors / count`; 0 when nothing was recorded. */
  errorRate: number;
}

export interface MetricsSummary {
  startedAt: number;
  endedAt: number;
  durationS: number;
  shards: number;
  /** Every `request` timing merged into one distribution. */
  http: TimingRow;
  timings: TimingRow[];
  totals: {
    requests: number;
    /** Every error recorded, under any name. */
    errors: number;
    errorsPerS: number;
    /** `errors / requests`; can exceed 1 when streams fail between requests. */
    errorRate: number;
  };
  counters: { name: string; value: number; rate: number }[];
  gauges: { name: string; current: number; max: number }[];
  statuses: { name: string; codes: Record<string, number> }[];
  /** Most frequent first. */
  errors: { name: string; kind: string; count: number; samples: string[] }[];
}

function row(
  name: string,
  kind: TimingKind,
  histogram: LatencyHistogram | null,
  errors: number,
  durationS: number,
): TimingRow {
  const count = histogram?.count ?? 0;
  return {
    name,
    kind,
    count,
    rate: count / durationS,
    mean: histogram?.mean ?? 0,
    p50: histogram?.percentile(50) ?? 0,
    p90: histogram?.percentile(90) ?? 0,
    p95: histogram?.percentile(95) ?? 0,
    p99: histogram?.percentile(99) ?? 0,
    max: histogram?.max ?? 0,
    errors,
    errorRate: count > 0 ? errors / count : 0,
  };
}

/** Compute the report rows of a snapshot (one shard's or a merged one). */
export function summarize(snapshot: MetricsSnapshot): MetricsSummary {
  const durationS = Math.max(
    0.001,
    (snapshot.endedAt - snapshot.startedAt) / 1000,
  );
  const errorsByName = new Map<string, number>();
  const errorList: MetricsSummary['errors'] = [];
  let errorTotal = 0;
  for (const [name, kinds] of Object.entries(snapshot.errors)) {
    let sum = 0;
    for (const [kind, entry] of Object.entries(kinds)) {
      sum += entry.count;
      errorList.push({
        name,
        kind,
        count: entry.count,
        samples: entry.samples,
      });
    }
    errorsByName.set(name, sum);
    errorTotal += sum;
  }
  errorList.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const http = new LatencyHistogram();
  let httpErrors = 0;
  const timings: TimingRow[] = [];
  for (const name of Object.keys(snapshot.timings).sort()) {
    const timing = snapshot.timings[name];
    const histogram = LatencyHistogram.decode(timing.histogram);
    const errors = errorsByName.get(name) ?? 0;
    if (timing.kind === 'request') {
      http.merge(histogram);
      httpErrors += errors;
    }
    timings.push(row(name, timing.kind, histogram, errors, durationS));
  }
  const httpRow = row('http', 'request', http, httpErrors, durationS);

  return {
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    durationS,
    shards: Math.max(1, snapshot.shards.length),
    http: httpRow,
    timings,
    totals: {
      requests: httpRow.count,
      errors: errorTotal,
      errorsPerS: errorTotal / durationS,
      errorRate: httpRow.count > 0 ? errorTotal / httpRow.count : 0,
    },
    counters: Object.entries(snapshot.counters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({ name, value, rate: value / durationS })),
    gauges: Object.entries(snapshot.gauges)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, gauge]) => ({
        name,
        current: gauge.current,
        max: gauge.max,
      })),
    statuses: Object.entries(snapshot.statuses)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, codes]) => ({ name, codes })),
    errors: errorList,
  };
}

const NAME_WIDTH = 52;

function fit(text: string, width: number): string {
  return text.length > width
    ? `${text.slice(0, width - 1)}…`
    : text.padEnd(width);
}

function formatMs(ms: number): string {
  if (ms >= 10_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return ms >= 100 ? ms.toFixed(0) : ms.toFixed(1);
}

function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function timingLine(r: TimingRow): string {
  return [
    fit(r.name, NAME_WIDTH),
    formatCount(r.count).padStart(9),
    r.rate.toFixed(1).padStart(8),
    formatMs(r.mean).padStart(7),
    formatMs(r.p50).padStart(7),
    formatMs(r.p90).padStart(7),
    formatMs(r.p95).padStart(7),
    formatMs(r.p99).padStart(7),
    formatMs(r.max).padStart(7),
    formatCount(r.errors).padStart(7),
    `${(r.errorRate * 100).toFixed(2)}%`.padStart(7),
  ].join(' ');
}

/**
 * Render a summary as a fixed-width console table: the `http` aggregate,
 * one row per timing (milliseconds), then counters, gauges and the most
 * frequent errors with one sample each.
 */
export function formatSummary(
  summary: MetricsSummary,
  options: { maxErrors?: number } = {},
): string {
  const header = [
    fit('metric', NAME_WIDTH),
    'count'.padStart(9),
    'rate/s'.padStart(8),
    'mean'.padStart(7),
    'p50'.padStart(7),
    'p90'.padStart(7),
    'p95'.padStart(7),
    'p99'.padStart(7),
    'max'.padStart(7),
    'errors'.padStart(7),
    'err%'.padStart(7),
  ].join(' ');
  const rule = '-'.repeat(header.length);
  const lines = [
    `duration ${summary.durationS.toFixed(1)}s · shards ${summary.shards} · requests ${summary.totals.requests} · errors ${summary.totals.errors} (${(summary.totals.errorRate * 100).toFixed(2)}%)`,
    header,
    rule,
    timingLine(summary.http),
    rule,
    ...summary.timings.map(timingLine),
  ];
  if (summary.counters.length > 0) {
    lines.push(
      '',
      `${fit('counter', NAME_WIDTH)} ${'value'.padStart(9)} ${'rate/s'.padStart(8)}`,
    );
    for (const counter of summary.counters) {
      lines.push(
        `${fit(counter.name, NAME_WIDTH)} ${formatCount(counter.value).padStart(9)} ${counter.rate.toFixed(1).padStart(8)}`,
      );
    }
  }
  if (summary.gauges.length > 0) {
    lines.push(
      '',
      `${fit('gauge', NAME_WIDTH)} ${'now'.padStart(9)} ${'max'.padStart(8)}`,
    );
    for (const gauge of summary.gauges) {
      lines.push(
        `${fit(gauge.name, NAME_WIDTH)} ${formatCount(gauge.current).padStart(9)} ${formatCount(gauge.max).padStart(8)}`,
      );
    }
  }
  const maxErrors = options.maxErrors ?? 20;
  if (summary.errors.length > 0) {
    lines.push('', 'errors (most frequent first)');
    for (const error of summary.errors.slice(0, maxErrors)) {
      lines.push(
        `${formatCount(error.count).padStart(9)}  ${error.name} · ${error.kind}`,
      );
      const sample = error.samples.at(-1);
      if (sample !== undefined) {
        lines.push(
          `           ${sample.replaceAll(/\s+/g, ' ').slice(0, 160)}`,
        );
      }
    }
    if (summary.errors.length > maxErrors) {
      lines.push(`           … ${summary.errors.length - maxErrors} more`);
    }
  }
  return lines.join('\n');
}
