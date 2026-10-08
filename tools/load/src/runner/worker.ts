/**
 * A generator process: one pool of virtual users on one Node event loop,
 * steered over IPC by the orchestrator.
 *
 * A single Node process drives tens of thousands of virtual users (each
 * mostly waiting: think time, an open stream), but one event loop is still
 * one core. The orchestrator forks one worker per core it may use and
 * splits the plan's user range between them; each worker reports its
 * metrics every few seconds and once more when it stops.
 */

import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

import { createAgent } from '../client/index.ts';
import { MetricsRegistry, type MetricsSnapshot } from '../metrics/index.ts';
import type { LoadPlan } from '../plan.ts';
import type {
  PersonaWeights,
  RunVirtualUser,
  ScenarioOptions,
} from '../scenario/contract.ts';
import { UserPool } from './pool.ts';

export interface WorkerConfig {
  plan: LoadPlan;
  range: { start: number; end: number };
  baseUrls: string[];
  authSecret: string | null;
  personas: PersonaWeights;
  scenario: ScenarioOptions;
  forwardedFor: boolean;
  seed: number;
  shard: { index: number; count: number };
  /** Which worker of this generator, for labels. */
  worker: number;
  snapshotEveryMs: number;
  /** Absolute path of the module exporting `runVirtualUser`. */
  scenarioModule: string;
  insecureTls: boolean;
  /** Source addresses for outgoing connections; empty: the system's choice. */
  localAddresses: string[];
}

export type ToWorker =
  | { type: 'start'; config: WorkerConfig }
  | { type: 'target'; users: number }
  | { type: 'stop'; timeoutMs: number };

export type FromWorker =
  | { type: 'ready'; capacity: number }
  | {
      type: 'snapshot';
      snapshot: MetricsSnapshot;
      active: number;
      final: boolean;
    }
  | { type: 'stopped'; stragglers: number }
  | { type: 'failed'; message: string };

function send(message: FromWorker): void {
  if (process.send === undefined) {
    throw new Error('the load worker must be started over IPC');
  }
  process.send(message);
}

async function loadScenario(modulePath: string): Promise<RunVirtualUser> {
  const loaded: unknown = await import(pathToFileURL(modulePath).href);
  const runUser =
    typeof loaded === 'object' && loaded !== null
      ? Reflect.get(loaded, 'runVirtualUser')
      : undefined;
  if (typeof runUser !== 'function') {
    throw new Error(`${modulePath} does not export runVirtualUser`);
  }
  return runUser as RunVirtualUser;
}

async function main(): Promise<void> {
  let pool: UserPool | null = null;
  let metrics: MetricsRegistry | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Series windows already shipped: each snapshot carries only newer ones. */
  let seriesSince = Number.NEGATIVE_INFINITY;

  const report = (final: boolean): void => {
    if (metrics === null || pool === null) return;
    const snapshot = metrics.snapshot({ seriesSince });
    const lastWindow = snapshot.series[snapshot.series.length - 1];
    // The newest window may still be open; resend it next time.
    if (lastWindow !== undefined && !final) seriesSince = lastWindow.start;
    send({ type: 'snapshot', snapshot, active: pool.active, final });
  };

  const start = async (config: WorkerConfig): Promise<void> => {
    let runUser: RunVirtualUser;
    try {
      runUser = await loadScenario(config.scenarioModule);
    } catch (error) {
      send({ type: 'failed', message: String(error) });
      return;
    }
    metrics = new MetricsRegistry({
      shard: {
        index: config.shard.index,
        count: config.shard.count,
        label: `${hostname()}#${config.worker}`,
      },
    });
    pool = new UserPool({
      plan: config.plan,
      range: config.range,
      baseUrls: config.baseUrls,
      agents:
        config.localAddresses.length === 0
          ? [createAgent({ insecureTls: config.insecureTls })]
          : config.localAddresses.map((localAddress) =>
              createAgent({ insecureTls: config.insecureTls, localAddress }),
            ),
      metrics,
      authSecret: config.authSecret,
      personas: config.personas,
      scenario: config.scenario,
      forwardedFor: config.forwardedFor,
      seed: config.seed,
      runUser,
    });
    timer = setInterval(() => report(false), config.snapshotEveryMs);
    send({ type: 'ready', capacity: pool.capacity });
  };

  const stop = async (timeoutMs: number): Promise<void> => {
    if (timer !== undefined) clearInterval(timer);
    const stragglers = (await pool?.stopAll(timeoutMs)) ?? 0;
    report(true);
    send({ type: 'stopped', stragglers });
    // Let the IPC queue drain, then leave even if a straggler holds a
    // socket open.
    setTimeout(() => process.exit(0), 200);
  };

  process.on('message', (raw: unknown) => {
    const message = raw as ToWorker;
    if (message.type === 'start') {
      void start(message.config);
      return;
    }
    if (message.type === 'target') {
      pool?.setTarget(message.users);
      return;
    }
    if (message.type === 'stop') {
      void stop(message.timeoutMs);
    }
  });
  process.on('disconnect', () => {
    // The orchestrator is gone: nobody will read another snapshot.
    process.exit(0);
  });
}

await main();
