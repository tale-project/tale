/**
 * One generator's run: fork worker processes, split this shard's users
 * between them, steer their target counts along the profile, watch the
 * numbers come in, and write the report.
 *
 * A distributed run is several generators, each started with its own
 * `--shard i/n` against the same plan; each writes its own report and
 * `merge` folds them into one. Nothing here talks to another generator, so
 * a million users is fifty of these on fifty machines, not one coordinator
 * that has to survive the whole run.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  type MetricsSnapshot,
  type SeriesWindowSnapshot,
  LatencyHistogram,
  mergeSnapshots,
} from '../metrics/index.ts';
import { shardRange, type LoadPlan } from '../plan.ts';
import type { PersonaWeights, ScenarioOptions } from '../scenario/contract.ts';
import {
  type DatabaseSnapshot,
  type MetricsEndpoint,
  type MetricsScrape,
  scrapeMetrics,
  snapshotDatabase,
} from './probes.ts';
import { type Profile, profileSeconds, targetAt } from './profiles.ts';
import type { FromWorker, ToWorker, WorkerConfig } from './worker.ts';

export interface RunConfig {
  plan: LoadPlan;
  profile: Profile;
  baseUrls: string[];
  authSecret: string | null;
  personas: PersonaWeights;
  scenario: ScenarioOptions;
  forwardedFor: boolean;
  seed: number;
  shard: { index: number; count: number };
  processes: number;
  scenarioModule: string;
  localAddresses: string[];
  /** Seconds between progress lines and worker snapshots. */
  progressSeconds: number;
  /** Server-side probes, read before and after the run. */
  metricsEndpoints: MetricsEndpoint[];
  database: { url: string; appDatabase: string } | null;
  /** Stage-level breakpoint criteria (stress profile). */
  breakpoint: { p95Ms: number; errorRate: number };
  /** Called with each progress line (the CLI prints it). */
  onProgress: (line: string) => void;
}

export interface StageResult {
  stage: number;
  users: number;
  requests: number;
  errors: number;
  errorRate: number;
  p95Ms: number;
  held: boolean;
}

export interface RunOutcome {
  startedAt: number;
  endedAt: number;
  snapshot: MetricsSnapshot;
  stages: StageResult[];
  /** The last stage that held, when the profile stops at a breakpoint. */
  breakingPoint: { stage: number; users: number } | null;
  stoppedEarly: boolean;
  workerFailures: string[];
  stragglers: number;
  probes: {
    metricsBefore: MetricsScrape[];
    metricsAfter: MetricsScrape[];
    databaseBefore: DatabaseSnapshot | null;
    databaseAfter: DatabaseSnapshot | null;
  };
}

interface WorkerState {
  child: ChildProcess;
  range: { start: number; end: number };
  capacity: number;
  ready: boolean;
  active: number;
  latest: MetricsSnapshot | null;
  /** Every series window this worker shipped, by window start. */
  series: Map<number, SeriesWindowSnapshot>;
  stopped: boolean;
  stragglers: number;
}

function sendTo(worker: WorkerState, message: ToWorker): void {
  if (worker.child.connected) worker.child.send(message);
}

/** Split `target` users over workers in proportion to their capacity. */
export function splitTarget(
  target: number,
  capacities: readonly number[],
): number[] {
  const total = capacities.reduce((sum, c) => sum + c, 0);
  if (total === 0) return capacities.map(() => 0);
  const clamped = Math.min(target, total);
  const shares = capacities.map((c) => Math.floor((clamped * c) / total));
  let left = clamped - shares.reduce((sum, s) => sum + s, 0);
  for (let i = 0; left > 0 && i < shares.length; i += 1) {
    const share = shares[i] ?? 0;
    if (share < (capacities[i] ?? 0)) {
      shares[i] = share + 1;
      left -= 1;
    }
  }
  return shares;
}

/** The workers' latest snapshots with their full series, folded into one. */
function foldSnapshots(
  workers: readonly WorkerState[],
): MetricsSnapshot | null {
  const snapshots: MetricsSnapshot[] = [];
  for (const worker of workers) {
    if (worker.latest === null) continue;
    snapshots.push({
      ...worker.latest,
      series: [...worker.series.values()].sort((a, b) => a.start - b.start),
    });
  }
  return snapshots.length === 0 ? null : mergeSnapshots(snapshots);
}

/** Requests, errors and the merged latency of the windows in [from, to). */
function windowsBetween(
  snapshot: MetricsSnapshot | null,
  from: number,
  to: number,
): { requests: number; errors: number; p95Ms: number } {
  if (snapshot === null) return { requests: 0, errors: 0, p95Ms: 0 };
  let requests = 0;
  let errors = 0;
  const latency: LatencyHistogram[] = [];
  for (const window of snapshot.series) {
    if (window.start < from || window.start >= to) continue;
    requests += window.requests;
    errors += window.errors;
    if (window.latency !== null) {
      latency.push(LatencyHistogram.decode(window.latency));
    }
  }
  const merged = latency.reduce<LatencyHistogram | null>((acc, h) => {
    if (acc === null) return h;
    acc.merge(h);
    return acc;
  }, null);
  return { requests, errors, p95Ms: merged?.percentile(95) ?? 0 };
}

function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export async function runLoad(config: RunConfig): Promise<RunOutcome> {
  const workerPath = fileURLToPath(new URL('./worker.ts', import.meta.url));
  const shardUsers = shardRange(
    config.plan.users.count,
    config.shard.index,
    config.shard.count,
  );
  const shardSize = shardUsers.end - shardUsers.start;
  const processes = Math.max(1, Math.min(config.processes, shardSize));
  const failures: string[] = [];

  const [metricsBefore, databaseBefore] = await Promise.all([
    Promise.all(config.metricsEndpoints.map((e) => scrapeMetrics(e))),
    config.database === null
      ? Promise.resolve(null)
      : snapshotDatabase(config.database.url, config.database.appDatabase),
  ]);

  const workers: WorkerState[] = [];
  for (let w = 0; w < processes; w += 1) {
    const local = shardRange(shardSize, w, processes);
    const range = {
      start: shardUsers.start + local.start,
      end: shardUsers.start + local.end,
    };
    const child = fork(workerPath, [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      serialization: 'advanced',
    });
    const state: WorkerState = {
      child,
      range,
      capacity: range.end - range.start,
      ready: false,
      active: 0,
      latest: null,
      series: new Map(),
      stopped: false,
      stragglers: 0,
    };
    child.on('message', (raw: unknown) => {
      const message = raw as FromWorker;
      if (message.type === 'ready') {
        state.ready = true;
        state.capacity = message.capacity;
      } else if (message.type === 'snapshot') {
        state.latest = message.snapshot;
        state.active = message.active;
        for (const window of message.snapshot.series) {
          state.series.set(window.start, window);
        }
      } else if (message.type === 'stopped') {
        state.stopped = true;
        state.stragglers = message.stragglers;
      } else {
        failures.push(`worker ${w}: ${message.message}`);
      }
    });
    child.on('exit', (code, signal) => {
      if (!state.stopped && code !== 0) {
        failures.push(
          `worker ${w} exited with ${signal === null ? `code ${code}` : signal}`,
        );
      }
      state.stopped = true;
    });
    const workerConfig: WorkerConfig = {
      plan: config.plan,
      range,
      baseUrls: config.baseUrls,
      authSecret: config.authSecret,
      personas: config.personas,
      scenario: config.scenario,
      forwardedFor: config.forwardedFor,
      seed: config.seed,
      shard: config.shard,
      worker: w,
      snapshotEveryMs: config.progressSeconds * 1000,
      scenarioModule: config.scenarioModule,
      localAddresses: config.localAddresses,
    };
    child.send({ type: 'start', config: workerConfig } satisfies ToWorker);
    workers.push(state);
  }

  // Wait for every worker to load its scenario before the clock starts.
  const readyBy = Date.now() + 60_000;
  while (workers.some((w) => !w.ready && !w.stopped) && Date.now() < readyBy) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (workers.every((w) => !w.ready)) {
    for (const w of workers) w.child.kill('SIGKILL');
    throw new Error(
      `no load worker started: ${failures.join('; ') || 'timed out'}`,
    );
  }

  const startedAt = Date.now();
  const totalSeconds = profileSeconds(config.profile);
  const stages: StageResult[] = [];
  let breakingPoint: RunOutcome['breakingPoint'] = null;
  let stoppedEarly = false;
  let currentStage = 0;
  let stageHoldFrom = 0;
  let lastProgressAt = startedAt;
  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  /** Judge a stage that just ended from the windows of its hold. */
  const closeStage = (index: number, endedAt: number): StageResult => {
    const stage = config.profile.stages[index];
    const folded = foldSnapshots(workers);
    const span = windowsBetween(folded, stageHoldFrom, endedAt);
    const errorRate = span.requests > 0 ? span.errors / span.requests : 0;
    const held =
      span.p95Ms <= config.breakpoint.p95Ms &&
      errorRate <= config.breakpoint.errorRate;
    return {
      stage: index,
      users: stage?.users ?? 0,
      requests: span.requests,
      errors: span.errors,
      errorRate,
      p95Ms: span.p95Ms,
      held,
    };
  };

  for (;;) {
    const elapsed = (Date.now() - startedAt) / 1000;
    const { users, stage } = targetAt(config.profile, elapsed);
    if (stage !== currentStage) {
      const result = closeStage(currentStage, Date.now());
      stages.push(result);
      config.onProgress(
        `stage ${currentStage + 1} @ ${formatCount(result.users)} users: p95 ${Math.round(result.p95Ms)} ms, errors ${(result.errorRate * 100).toFixed(2)}% — ${result.held ? 'held' : 'BROKE'}`,
      );
      if (config.profile.stopOnThresholdFailure) {
        if (!result.held) {
          stoppedEarly = true;
          break;
        }
        breakingPoint = { stage: currentStage, users: result.users };
      }
      currentStage = stage;
    }
    // The hold of a stage starts once its ramp is done.
    const stageDef = config.profile.stages[currentStage];
    if (stageDef !== undefined) {
      let at = 0;
      for (let i = 0; i < currentStage; i += 1) {
        const s = config.profile.stages[i];
        if (s !== undefined) at += s.rampSeconds + s.holdSeconds;
      }
      stageHoldFrom = startedAt + (at + stageDef.rampSeconds) * 1000;
    }
    if (stage >= config.profile.stages.length || elapsed >= totalSeconds) break;
    if (interrupted) {
      stoppedEarly = true;
      break;
    }
    const shares = splitTarget(
      users,
      workers.map((w) => (w.stopped ? 0 : w.capacity)),
    );
    workers.forEach((w, i) =>
      sendTo(w, { type: 'target', users: shares[i] ?? 0 }),
    );

    if (Date.now() - lastProgressAt >= config.progressSeconds * 1000) {
      lastProgressAt = Date.now();
      config.onProgress(progressLine(workers, elapsed, users, currentStage));
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);

  // Wind down: every worker stops its users and ships a final snapshot.
  for (const w of workers) sendTo(w, { type: 'stop', timeoutMs: 30_000 });
  const stopBy = Date.now() + 45_000;
  while (workers.some((w) => !w.stopped) && Date.now() < stopBy) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const w of workers) {
    if (!w.stopped) {
      failures.push(
        `worker of users ${w.range.start}-${w.range.end} did not stop; killed`,
      );
      w.child.kill('SIGKILL');
    }
  }
  const endedAt = Date.now();

  const [metricsAfter, databaseAfter] = await Promise.all([
    Promise.all(config.metricsEndpoints.map((e) => scrapeMetrics(e))),
    config.database === null
      ? Promise.resolve(null)
      : snapshotDatabase(config.database.url, config.database.appDatabase),
  ]);

  const snapshot = foldSnapshots(workers);
  if (snapshot === null) {
    throw new Error(
      `no worker reported any metrics: ${failures.join('; ') || 'unknown'}`,
    );
  }
  return {
    startedAt,
    endedAt,
    snapshot,
    stages,
    breakingPoint,
    stoppedEarly,
    workerFailures: failures,
    stragglers: workers.reduce((sum, w) => sum + w.stragglers, 0),
    probes: { metricsBefore, metricsAfter, databaseBefore, databaseAfter },
  };
}

/** One line of live progress from the workers' latest numbers. */
function progressLine(
  workers: readonly WorkerState[],
  elapsed: number,
  target: number,
  stage: number,
): string {
  const active = workers.reduce((sum, w) => sum + w.active, 0);
  const folded = foldSnapshots(workers);
  // The last two complete windows, so the line reflects now, not the run.
  const windowMs = folded?.windowMs ?? 5_000;
  const now = Date.now();
  const recent = windowsBetween(folded, now - windowMs * 3, now - windowMs);
  const seconds = (windowMs * 2) / 1000;
  const errorRate = recent.requests > 0 ? recent.errors / recent.requests : 0;
  const sse = folded?.gauges['sse.events.open']?.current ?? 0;
  const threads = folded?.gauges['sse.thread.open']?.current ?? 0;
  const ttft = folded?.timings['chat.ttft'];
  const ttftP95 =
    ttft === undefined
      ? null
      : LatencyHistogram.decode(ttft.histogram).percentile(95);
  return [
    `t=${Math.round(elapsed)}s`,
    `stage=${stage + 1}`,
    `users=${formatCount(active)}/${formatCount(target)}`,
    `rps=${formatCount(recent.requests / seconds)}`,
    `p95=${Math.round(recent.p95Ms)}ms`,
    `err=${(errorRate * 100).toFixed(2)}%`,
    `streams=${formatCount(sse)}+${formatCount(threads)}`,
    ttftP95 === null ? 'ttft=–' : `ttft.p95=${Math.round(ttftP95)}ms`,
  ].join('  ');
}
