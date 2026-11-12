import * as logger from '../../../../utils/logger';
import type { HealthState } from '../../types';
import type { Healthcheck } from '../compile/translate';
import { execInInstance, type IncusVerbContext } from './exec';
import { HealthTracker } from './health-tracker';
import { instanceStartedAt } from './instances';
import { stoppedAfterCrashes } from './logs';

/**
 * Health on Incus (design D-24): Incus runs no health check, so the CLI runs
 * the service's compose healthcheck by exec, as Docker would, and judges the
 * results with Docker's state machine (`HealthTracker`).
 *
 * - `CMD` runs its argv; `CMD-SHELL` runs `/bin/sh -c <command>`, as Docker
 *   does. A probe gets the healthcheck's `timeout`: past it, or with a
 *   non-zero exit, it failed. Its output is not read (mode 1 where the image
 *   has `timeout`).
 * - A tracker lives per instance start: a restart (a later `started_at`)
 *   starts a fresh one, as Docker resets health on a restart.
 * - A stopped instance has no health. One that stopped by itself while it
 *   was wanted running is reported `unhealthy`: `boot.autorestart` gave up
 *   on it after repeated crashes (R-09).
 * - Nothing here reads a console: a running console hands each line out
 *   once (S21).
 */

/** The healthcheck an instance's compiled spec declares; undefined when the
 * caller knows no spec for it. */
export type HealthcheckLookup = (
  name: string,
) => Healthcheck | { disabled: true } | undefined;

/** The command a healthcheck test runs, as Docker runs it. */
export function probeArgv(test: readonly string[]): string[] {
  const [kind, ...rest] = test;
  if (kind === 'CMD-SHELL') return ['/bin/sh', '-c', rest.join(' ')];
  if (kind === 'CMD' && rest.length > 0) return rest;
  throw new Error(`Not a healthcheck test: ${JSON.stringify(test)}`);
}

export class IncusHealth {
  private readonly trackers = new Map<
    string,
    { startedAt: string; tracker: HealthTracker }
  >();

  constructor(
    private readonly context: IncusVerbContext,
    private readonly lookup: HealthcheckLookup,
    private readonly now: () => number = Date.now,
  ) {}

  /** The instance's health now, probing it when a probe is due. */
  async health(name: string): Promise<HealthState> {
    const read = await this.context.client.getInstance(name);
    if (read === undefined) return 'none';
    const { status, config } = read.instance;
    if (status !== 'Running') {
      this.trackers.delete(name);
      return stoppedAfterCrashes(status, config) ? 'unhealthy' : 'none';
    }
    const check = this.lookup(name);
    if (check === undefined)
      throw new Error(
        `The health check of ${name} is unknown: the Incus runtime reads it from the compiled stack, which it was not given.`,
      );
    if ('disabled' in check) return 'none';
    const startedAt =
      (await instanceStartedAt(this.context.client, name)) ??
      new Date(this.now()).toISOString();
    let entry = this.trackers.get(name);
    if (entry === undefined || entry.startedAt !== startedAt) {
      entry = {
        startedAt,
        tracker: new HealthTracker(check, Date.parse(startedAt)),
      };
      this.trackers.set(name, entry);
    }
    const at = this.now();
    if (!entry.tracker.due(at)) return entry.tracker.current;
    let passed: boolean;
    try {
      const result = await execInInstance(
        this.context,
        name,
        probeArgv(check.test),
        {
          output: 'discard',
          timeoutS: Math.max(1, Math.ceil(check.timeoutMs / 1000)),
        },
      );
      passed = result.exitCode === 0;
    } catch (error) {
      // A probe past its timeout, or one Incus could not run, failed.
      logger.debug(
        `The health probe of ${name} failed to run: ${error instanceof Error ? error.message : String(error)}`,
      );
      passed = false;
    }
    return entry.tracker.record(passed, at);
  }
}
