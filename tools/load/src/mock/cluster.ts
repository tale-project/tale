/**
 * Several mock processes behind one port, with one metrics endpoint.
 *
 * One Node process saturates one core long before a large test's stream
 * count, so `processes > 1` forks that many workers through `node:cluster`;
 * they share the listening port and the primary hands out connections.
 * Each worker keeps its own metrics; the primary serves `/metrics` on
 * `metricsPort` by asking every worker for a snapshot over IPC and merging
 * them, so a scrape sees the whole fleet. A worker that dies is replaced.
 */

import cluster, { type Worker } from 'node:cluster';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { parseMockOptions, type MockOptions } from './config.ts';
import {
  mergeSnapshots,
  renderPrometheus,
  type MetricsSnapshot,
} from './metrics.ts';
import { createMockServer } from './server.ts';

/** Environment variable carrying the resolved options to a worker. */
const WORKER_OPTIONS_ENV = 'TALE_LOAD_MOCK_WORKER_OPTIONS';
/** How long a scrape waits for workers' snapshots. */
const SNAPSHOT_TIMEOUT_MS = 1000;
/** How long a worker may take to start listening. */
const READY_TIMEOUT_MS = 30_000;
/** How long shutdown waits before killing a worker. */
const SHUTDOWN_TIMEOUT_MS = 5000;

/** Messages between the primary and its workers. */
type ClusterMessage =
  | { readonly type: 'ready'; readonly url: string }
  | { readonly type: 'metrics-request'; readonly id: number }
  | {
      readonly type: 'metrics-snapshot';
      readonly id: number;
      readonly snapshot: MetricsSnapshot;
    }
  | { readonly type: 'shutdown' };

function isClusterMessage(value: unknown): value is ClusterMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export interface MockCluster {
  /** Base URL clients use (every worker answers on it). */
  readonly url: string;
  /** Base URL of the primary's aggregated `/metrics`. */
  readonly metricsUrl: string;
  readonly workers: number;
  close(): Promise<void>;
}

/** A port nobody listens on right now, for a cluster asked for port 0. */
async function freePort(host: string): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen({ host, port: 0 }, () => resolve());
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function hostForUrl(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '') return '127.0.0.1';
  return host.includes(':') ? `[${host}]` : host;
}

/** One worker's share of the provider-wide stream limit (0: unlimited). */
export function workerStreamLimit(limit: number, processes: number): number {
  if (limit === 0) return 0;
  return Math.max(1, Math.ceil(limit / Math.max(1, processes)));
}

/**
 * Fork `options.processes` workers and serve aggregated metrics. Resolves
 * once every worker listens. Must run in the primary process.
 */
export async function startMockCluster(
  options: MockOptions,
): Promise<MockCluster> {
  if (!cluster.isPrimary) {
    throw new Error('startMockCluster must run in the primary process');
  }
  const port = options.port === 0 ? await freePort(options.host) : options.port;
  const metricsPort =
    options.metricsPort ?? (options.port === 0 ? 0 : port + 1);
  const baseSeed = options.seed;

  cluster.setupPrimary({
    exec: fileURLToPath(new URL('./cluster-worker.ts', import.meta.url)),
    args: [],
  });

  const workers = new Map<number, Worker>();
  let closing = false;
  let nextRequest = 1;
  const pending = new Map<
    number,
    { snapshots: MetricsSnapshot[]; expected: number; done: () => void }
  >();
  const latest = new Map<number, MetricsSnapshot>();

  const fork = (index: number): Worker => {
    const workerOptions: MockOptions = {
      ...options,
      port,
      processes: 1,
      // The stream limit is the provider's: each worker admits its share.
      // (The prompt cache stays per worker — a turn that lands on another
      // worker than its conversation's last reads no cached prefix.)
      maxConcurrentStreams: workerStreamLimit(
        options.maxConcurrentStreams,
        options.processes,
      ),
      // Workers draw different streams from one seeded run.
      ...(baseSeed !== undefined ? { seed: baseSeed + index * 7919 } : {}),
    };
    const worker = cluster.fork({
      [WORKER_OPTIONS_ENV]: JSON.stringify(workerOptions),
    });
    workers.set(index, worker);
    worker.on('message', (message: unknown) => {
      if (!isClusterMessage(message) || message.type !== 'metrics-snapshot') {
        return;
      }
      latest.set(index, message.snapshot);
      const request = pending.get(message.id);
      if (request === undefined) return;
      request.snapshots.push(message.snapshot);
      if (request.snapshots.length >= request.expected) request.done();
    });
    worker.on('exit', (code, signal) => {
      if (closing || workers.get(index) !== worker) return;
      console.error(
        `[mock] worker ${index} exited (${signal ?? code}); starting a replacement`,
      );
      fork(index);
    });
    return worker;
  };

  const ready = Array.from(
    { length: options.processes },
    (_unused, index) =>
      new Promise<void>((resolve, reject) => {
        const worker = fork(index);
        const timer = setTimeout(
          () => reject(new Error(`mock worker ${index} did not start in time`)),
          READY_TIMEOUT_MS,
        );
        worker.on('message', (message: unknown) => {
          if (isClusterMessage(message) && message.type === 'ready') {
            clearTimeout(timer);
            resolve();
          }
        });
        worker.once('exit', (code) => {
          clearTimeout(timer);
          reject(
            new Error(
              `mock worker ${index} exited with ${code} while starting`,
            ),
          );
        });
      }),
  );
  try {
    await Promise.all(ready);
  } catch (error) {
    closing = true;
    for (const worker of workers.values()) worker.kill();
    throw error;
  }

  const collect = async (): Promise<MetricsSnapshot> => {
    const id = nextRequest++;
    const alive = [...workers.values()].filter((worker) =>
      worker.isConnected(),
    );
    const snapshots: MetricsSnapshot[] = [];
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SNAPSHOT_TIMEOUT_MS);
      pending.set(id, {
        snapshots,
        expected: alive.length,
        done: () => {
          clearTimeout(timer);
          resolve();
        },
      });
      if (alive.length === 0) resolve();
      for (const worker of alive) {
        worker.send({ type: 'metrics-request', id } satisfies ClusterMessage);
      }
    });
    pending.delete(id);
    // A worker that missed the deadline still counts with its last snapshot.
    return mergeSnapshots(
      snapshots.length >= alive.length ? snapshots : [...latest.values()],
    );
  };

  const serveMetrics = async (res: ServerResponse): Promise<void> => {
    try {
      const snapshot = await collect();
      res.writeHead(200, {
        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      res.end(renderPrometheus(snapshot, { mock_workers: workers.size }));
    } catch (error) {
      console.error('[mock] metrics aggregation failed:', error);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('metrics aggregation failed\n');
    }
  };

  const metricsServer: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, workers: workers.size }));
      return;
    }
    if (path !== '/metrics') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }
    void serveMetrics(res);
  });
  await new Promise<void>((resolve, reject) => {
    metricsServer.once('error', reject);
    metricsServer.listen({ host: options.host, port: metricsPort }, () =>
      resolve(),
    );
  });
  const boundMetricsPort = (metricsServer.address() as AddressInfo).port;

  return {
    url: `http://${hostForUrl(options.host)}:${port}`,
    metricsUrl: `http://${hostForUrl(options.host)}:${boundMetricsPort}`,
    workers: options.processes,
    async close() {
      closing = true;
      await Promise.all(
        [...workers.values()].map(
          (worker) =>
            new Promise<void>((resolve) => {
              if (worker.isDead()) {
                resolve();
                return;
              }
              const timer = setTimeout(() => {
                worker.kill('SIGKILL');
              }, SHUTDOWN_TIMEOUT_MS);
              worker.once('exit', () => {
                clearTimeout(timer);
                resolve();
              });
              if (worker.isConnected()) {
                worker.send({ type: 'shutdown' } satisfies ClusterMessage);
              } else {
                worker.kill();
              }
            }),
        ),
      );
      await new Promise<void>((resolve) => {
        metricsServer.close(() => resolve());
        metricsServer.closeAllConnections();
      });
    },
  };
}

/**
 * The worker side: start a server from the options the primary passed,
 * report ready, answer snapshot requests, and shut down on request.
 */
export async function runClusterWorker(): Promise<void> {
  const raw = process.env[WORKER_OPTIONS_ENV];
  if (raw === undefined) {
    throw new Error(`${WORKER_OPTIONS_ENV} is not set; not a mock worker`);
  }
  const options = parseMockOptions(
    JSON.parse(raw) as Record<string, string>,
    {},
  );
  const server = await createMockServer(options, {});
  const send = (message: ClusterMessage): void => {
    process.send?.(message);
  };
  process.on('message', (message: unknown) => {
    if (!isClusterMessage(message)) return;
    if (message.type === 'metrics-request') {
      send({
        type: 'metrics-snapshot',
        id: message.id,
        snapshot: server.metrics.snapshot(),
      });
    } else if (message.type === 'shutdown') {
      server.close().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error('[mock] worker shutdown failed:', error);
          process.exit(1);
        },
      );
    }
  });
  send({ type: 'ready', url: server.url });
}
