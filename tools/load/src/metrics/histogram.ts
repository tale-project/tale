/**
 * Latency histograms for the load harness.
 *
 * A thin wrapper over HdrHistogram: callers think in milliseconds, the
 * histogram stores whole microseconds so sub-millisecond requests against a
 * local target keep their resolution. The trackable range is fixed (1 µs to
 * one hour) and values outside it are clamped rather than thrown, because a
 * load run must never die on one absurd sample.
 *
 * Histograms travel between shard processes as HdrHistogram's compressed
 * base64 encoding, so a coordinator can merge fifty shards into exact
 * percentiles instead of averaging averages.
 */

import {
  build,
  decodeFromCompressedBase64,
  encodeIntoCompressedBase64,
} from 'hdr-histogram-js';
import type { Histogram } from 'hdr-histogram-js';

/** Highest value tracked, in microseconds: one hour. */
export const HIGHEST_TRACKABLE_US = 3_600_000_000;

/** Significant decimal digits HdrHistogram keeps for each recorded value. */
export type SignificantDigits = 1 | 2 | 3 | 4 | 5;

export interface LatencyHistogramOptions {
  /**
   * Value precision. Three digits (the default) keeps every percentile within
   * 0.1 % at roughly 95 KB per histogram; two digits cost about 14 KB, which
   * is what the per-window series uses.
   */
  significantDigits?: SignificantDigits;
}

function buildRaw(significantDigits: SignificantDigits): Histogram {
  return build({
    lowestDiscernibleValue: 1,
    highestTrackableValue: HIGHEST_TRACKABLE_US,
    numberOfSignificantValueDigits: significantDigits,
    // A fixed range keeps the footprint predictable; `record` clamps instead.
    autoResize: false,
  });
}

function toMicros(ms: number): number {
  if (!(ms > 0)) {
    return 0;
  }
  const us = Math.round(ms * 1000);
  return us > HIGHEST_TRACKABLE_US ? HIGHEST_TRACKABLE_US : us;
}

/** A latency distribution recorded in milliseconds. */
export class LatencyHistogram {
  readonly #raw: Histogram;

  /**
   * `raw` adopts an existing HdrHistogram instead of allocating one; only
   * `decode` passes it, so ordinary callers give options alone.
   */
  constructor(options: LatencyHistogramOptions = {}, raw?: Histogram) {
    this.#raw = raw ?? buildRaw(options.significantDigits ?? 3);
  }

  /** Rebuild a histogram from `encode()` output. Throws on malformed input. */
  static decode(encoded: string): LatencyHistogram {
    return new LatencyHistogram({}, decodeFromCompressedBase64(encoded));
  }

  /** Record one duration. Negative and non-finite values record as 0. */
  record(ms: number): void {
    this.#raw.recordValue(toMicros(ms));
  }

  /** Record the same duration `count` times. */
  recordMany(ms: number, count: number): void {
    if (count > 0) {
      this.#raw.recordValueWithCount(toMicros(ms), count);
    }
  }

  /** The value at percentile `p` (0–100), in milliseconds; 0 when empty. */
  percentile(p: number): number {
    return this.#raw.getValueAtPercentile(p) / 1000;
  }

  /** Arithmetic mean in milliseconds; 0 when empty. */
  get mean(): number {
    return this.#raw.mean / 1000;
  }

  /** Number of recorded values. */
  get count(): number {
    return this.#raw.totalCount;
  }

  /**
   * Largest recorded value in milliseconds, at the histogram's precision;
   * 0 when empty. Read through the buckets (not the exact tracked maximum)
   * so a decoded or merged histogram reports the same value as the live one.
   */
  get max(): number {
    return this.#raw.getValueAtPercentile(100) / 1000;
  }

  /** Smallest recorded value in milliseconds; 0 when empty. */
  get min(): number {
    return this.#raw.totalCount === 0 ? 0 : this.#raw.minNonZeroValue / 1000;
  }

  /** Compressed base64 encoding, the shard-to-coordinator wire format. */
  encode(): string {
    return encodeIntoCompressedBase64(this.#raw);
  }

  /** Add every value of `other` into this histogram. */
  merge(other: LatencyHistogram): void {
    this.#raw.add(other.#raw);
  }

  /** Drop every recorded value, keeping the allocated counts array. */
  reset(): void {
    this.#raw.reset();
  }
}

/**
 * Merge a list of encoded histograms into one, or `null` when the list holds
 * no value. Used by snapshot merging, which only ever sees encoded strings.
 */
export function mergeEncoded(
  encoded: readonly string[],
  options: LatencyHistogramOptions = {},
): LatencyHistogram | null {
  if (encoded.length === 0) {
    return null;
  }
  const merged = new LatencyHistogram(options);
  for (const item of encoded) {
    merged.merge(LatencyHistogram.decode(item));
  }
  return merged;
}
