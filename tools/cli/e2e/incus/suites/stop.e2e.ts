// stop: a graceful stop through Incus reaches each service as its own stop
// signal, through the patched init at /init (design D-21..D-23, 8). Postgres
// shuts down cleanly ("database system is shut down") and starts again with
// no recovery; the worker hears SIGTERM and drains before it ends; both stop
// inside Incus's timeout without being killed. The stack serves through the
// edge again afterwards, and each test leaves its service running whatever
// it found.

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import {
  consoleOf,
  deployed,
  incus,
  instancesOf,
  loadLab,
  record,
  throughEdge,
  until,
} from '../harness';

setDefaultTimeout(30 * 60_000);
const lab = loadLab();

/** Stop `name` cleanly within `seconds`: Incus fails the stop instead of
 * killing it when the service does not end in time. */
function stopCleanly(name: string, seconds: number): number {
  const started = performance.now();
  incus(lab, [
    'stop',
    name,
    '--project',
    lab.name,
    '--timeout',
    String(seconds),
  ]);
  return Math.round(performance.now() - started);
}

/** Start `name` again if it is not running. */
function running(name: string): void {
  const instance = instancesOf(lab).find((entry) => entry.name === name);
  if (instance?.status !== 'Running')
    incus(lab, ['start', name, '--project', lab.name]);
}

function exec(name: string, script: string): { code: number; stdout: string } {
  return incus(
    lab,
    ['exec', name, '--project', lab.name, '--', 'sh', '-c', script],
    { allowFailure: true },
  );
}

async function serving(): Promise<void> {
  await until(
    'the stack to serve through the edge again',
    async () => {
      const target = throughEdge(lab, '/api/health/ready');
      const response = await fetch(target.url, {
        headers: target.headers,
        signal: AbortSignal.timeout(5_000),
      });
      await response.arrayBuffer();
      return response.status === 200;
    },
    { timeoutMs: 10 * 60_000, intervalMs: 2_000 },
  );
}

/** The newest two files of Postgres's own log (its logging collector writes
 * there, not to the console). */
function postgresLog(): string {
  return exec(
    'db',
    'cd /var/lib/postgresql/data/log && cat $(ls -tr | tail -n 2)',
  ).stdout;
}

describe('stop', () => {
  test('Postgres shuts down cleanly and starts again without recovery', async () => {
    deployed(lab);
    try {
      const stopMs = stopCleanly('db', 120);
      record(lab, 'stop', { dbStopMs: stopMs });
    } finally {
      running('db');
    }
    await until(
      'Postgres to accept connections again',
      () => exec('db', 'pg_isready -q').code === 0,
      { timeoutMs: 5 * 60_000, intervalMs: 2_000 },
    );
    const log = postgresLog();
    const shutdown = log.lastIndexOf('database system is shut down');
    expect(shutdown).toBeGreaterThan(-1);
    const restart = log.slice(shutdown);
    expect(restart).toContain('database system was shut down at');
    expect(restart).toContain('database system is ready to accept connections');
    expect(restart).not.toContain('automatic recovery in progress');
    expect(restart).not.toContain('was interrupted');
    await serving();
  });

  test('the worker hears SIGTERM and drains before it ends', async () => {
    deployed(lab);
    const worker = instancesOf(lab).find((instance) =>
      instance.name.startsWith('backend-worker'),
    );
    expect(worker).toBeDefined();
    const name = worker?.name ?? 'backend-worker-1';
    // What the console held before is taken, so what follows is this stop's.
    consoleOf(lab, name);
    let said = '';
    try {
      const stopMs = stopCleanly(name, 120);
      record(lab, 'stop', { workerStopMs: stopMs });
      said = consoleOf(lab, name);
    } finally {
      running(name);
    }
    expect(said).toContain('SIGTERM received — shutting down');
    await serving();
  });
});
