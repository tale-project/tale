import type { HealthState } from '../../types';
import type { Healthcheck } from '../compile/translate';

/**
 * Docker's health state machine, without Docker (design D-24): the CLI runs a
 * service's compose healthcheck by exec and feeds each result here. Pure: the
 * caller says when it is and what a probe answered.
 *
 * The rules, as Docker applies them
 * (https://docs.docker.com/reference/dockerfile/#healthcheck, read
 * 2026-11-13):
 * - An instance starts `starting`. One passing probe makes it `healthy`, and
 *   resets the count of failures in a row.
 * - A failing probe (a non-zero exit, or one past its `timeout`) counts
 *   toward `retries`; at `retries` failures in a row it is `unhealthy`.
 * - Within `start_period` of the start, a failure is not counted while the
 *   instance has never passed; once it has passed, every failure counts.
 * - Probes run every `interval`; within the start period every
 *   `start_interval` (5 s by default), so a starting service is found
 *   healthy as soon as Docker would find it.
 *
 * One difference is the point of it: Docker probes from the moment the
 * container starts, the CLI only while it watches. A tracker made for an
 * instance that started long ago probes at once.
 */

/** Docker's `start_interval` default. */
const DEFAULT_START_INTERVAL_MS = 5_000;

export class HealthTracker {
  private state: Exclude<HealthState, 'none'> = 'starting';
  private failures = 0;
  private everPassed = false;
  private lastProbeAt: number | null = null;

  constructor(
    private readonly check: Healthcheck,
    /** When the instance last started, in ms (Incus `started_at`). */
    private readonly startedAt: number,
    private readonly startIntervalMs = DEFAULT_START_INTERVAL_MS,
  ) {}

  /** The state the probes so far give. */
  get current(): Exclude<HealthState, 'none'> {
    return this.state;
  }

  /** Failures in a row since the last pass (Docker's `FailingStreak`). */
  get failingStreak(): number {
    return this.failures;
  }

  private inStartPeriod(now: number): boolean {
    return now - this.startedAt < this.check.startPeriodMs;
  }

  /** Whether a probe is due at `now`: the first at once, then one per
   * interval (per start interval inside the start period). */
  due(now: number): boolean {
    if (this.lastProbeAt === null) return true;
    const interval = this.inStartPeriod(now)
      ? Math.min(this.startIntervalMs, this.check.intervalMs)
      : this.check.intervalMs;
    return now - this.lastProbeAt >= interval;
  }

  /** Record what one probe at `at` answered; returns the new state. */
  record(passed: boolean, at: number): Exclude<HealthState, 'none'> {
    this.lastProbeAt = at;
    if (passed) {
      this.everPassed = true;
      this.failures = 0;
      this.state = 'healthy';
      return this.state;
    }
    if (!this.everPassed && this.inStartPeriod(at)) return this.state;
    this.failures += 1;
    if (this.failures >= this.check.retries) this.state = 'unhealthy';
    return this.state;
  }
}
