/** Uncached, serial orchestration: every measurement owns a fresh worker. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { cpus, freemem, loadavg, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { workspaceInventory } from './inventory';
import { summarize } from './statistics';
import {
  optionalWorkloads,
  root,
  workloadRuntimes,
  type WorkloadId,
} from './workloads';

const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    samples: { type: 'string', default: '20' },
    workload: { type: 'string', multiple: true },
    http: { type: 'string', multiple: true },
    list: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'bun run test:performance [--samples 20] [--output /absolute/report.json] [--workload shared.lines] [--http @tale/web=http://127.0.0.1:3001/] [--list]',
  );
  process.exit(0);
}
const samples = Number(values.samples);
assert.ok(
  Number.isInteger(samples) && samples >= 3 && samples <= 1000,
  '--samples must be an integer from 3 to 1000',
);
const selected =
  values.workload ??
  Object.keys(workloadRuntimes).filter((id) => !optionalWorkloads.has(id));
for (const id of selected)
  assert.ok(Object.hasOwn(workloadRuntimes, id), `Unknown workload: ${id}`);
if (values.list) {
  console.log(
    JSON.stringify(
      {
        workloads: workloadRuntimes,
        optionalWorkloads: [...optionalWorkloads],
        workspaces: await workspaceInventory(new Set(), new Set()),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const targets = (values.http ?? []).map((target) => {
  const separator = target.indexOf('=');
  assert.ok(
    separator > 0,
    '--http expects @tale/workspace=http://127.0.0.1:port/path',
  );
  const name = target.slice(0, separator);
  const url = new URL(target.slice(separator + 1));
  assert.ok(
    ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'HTTP performance targets must use loopback',
  );
  assert.ok(
    !url.username && !url.password,
    'HTTP target must not carry credentials',
  );
  return { name, url };
});
await workspaceInventory(
  new Set(),
  new Set(targets.map((target) => target.name)),
);

const directory = await mkdtemp(join(tmpdir(), 'tale-performance-'));
const measurements: Record<string, unknown>[] = [];
const loadAverageAtStart = loadavg();
const measured = new Set<string>();
let failures = 0;
let interrupted = false;
let stopActiveWorker: (() => void) | undefined;
const cancellation = new AbortController();
const interrupt = () => {
  interrupted = true;
  cancellation.abort(new Error('Performance run interrupted'));
  stopActiveWorker?.();
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  for (const id of selected) {
    if (interrupted) break;
    console.error(`Measuring ${id} (${samples} samples)...`);
    const output = join(directory, `${id}.json`);
    const fixtureRoot = join(directory, `${id}-fixtures`);
    await mkdir(fixtureRoot);
    if (interrupted) break;
    const runtime = workloadRuntimes[id as WorkloadId];
    const command =
      runtime === 'node'
        ? [
            'node',
            '--expose-gc',
            '--experimental-transform-types',
            '--disable-warning=ExperimentalWarning',
            '--import',
            resolve(root, 'services/platform/backend/node-loader.mjs'),
          ]
        : [process.execPath];
    const child = Bun.spawn(
      [
        ...command,
        resolve(root, 'scripts/performance/worker.ts'),
        id,
        String(samples),
        output,
        fixtureRoot,
      ],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const stopChild = () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      forceKill ??= setTimeout(() => child.kill('SIGKILL'), 10000);
    };
    stopActiveWorker = stopChild;
    const deadline = setTimeout(stopChild, 180000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0)
        throw new Error(
          `Worker exit ${exitCode}: ${(stderr || stdout).slice(-6000)}`,
        );
      const result = JSON.parse(await readFile(output, 'utf8')) as Record<
        string,
        unknown
      >;
      measurements.push({
        ...result,
        processPeakRssBytes: child.resourceUsage()?.maxRSS ?? null,
        processPeakRssScope:
          'OS-reported subprocess resource usage, including imports, fixtures and warmup; may include reaped descendants on the host OS. Not aggregate concurrent process-tree RSS.',
      });
      measured.add(id);
      console.error(
        `  ${Number(result.p50Ms).toFixed(2)}ms p50 / ${Number(result.p95Ms).toFixed(2)}ms p95 per sample`,
      );
    } catch (error) {
      failures++;
      measurements.push({ id, status: 'failed', error: String(error) });
      console.error(`  Failed: ${String(error)}`);
    } finally {
      clearTimeout(deadline);
      clearTimeout(forceKill);
      stopActiveWorker = undefined;
    }
  }

  const measuredHttp = new Set<string>();
  for (const { name, url } of targets) {
    if (interrupted) break;
    const targetLabel = `${url.origin}${url.pathname}`;
    console.error(`Measuring ${name} HTTP ${targetLabel}...`);
    try {
      const durations: number[] = [];
      let bytes = 0;
      const start = performance.now();
      // Request-level samples, ten at a time. No headers/tokens are invented;
      // choose a public fixture endpoint. Redirects and errors fail the lane.
      for (let batch = 0; batch < Math.ceil(samples / 10); batch++) {
        const requests = await Promise.allSettled(
          Array.from(
            { length: Math.min(10, samples - batch * 10) },
            async () => {
              const began = performance.now();
              const response = await fetch(url, {
                redirect: 'manual',
                signal: AbortSignal.any([
                  AbortSignal.timeout(30000),
                  cancellation.signal,
                ]),
              });
              const body = await response.arrayBuffer();
              assert.equal(response.status, 200, `${name} expected HTTP 200`);
              bytes += body.byteLength;
              durations.push(performance.now() - began);
            },
          ),
        );
        for (const request of requests) {
          if (request.status === 'rejected') throw request.reason;
        }
      }
      const wallMs = performance.now() - start;
      measurements.push({
        id: `http:${name}`,
        status: 'measured',
        target: targetLabel,
        concurrency: Math.min(10, samples),
        unit: 'requests',
        ...summarize(durations, 1),
        wallMs,
        operationsPerSecond: (samples * 1000) / wallMs,
        responseBytes: bytes,
        memory: null,
        scope:
          'Real HTTP route only; server memory, browser rendering and other endpoints are not measured. No warmup.',
      });
      measuredHttp.add(name);
    } catch (error) {
      failures++;
      measurements.push({
        id: `http:${name}`,
        status: 'failed',
        error: String(error),
      });
    }
  }

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    workingTreeDirty:
      execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      }).trim().length > 0,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      bun: Bun.version,
      node: execFileSync('node', ['--version'], { encoding: 'utf8' }).trim(),
      cpuModel: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryAtReportBytes: freemem(),
      loadAverageAtStart,
      loadAverageAtEnd: loadavg(),
    },
    methodology:
      'Uncached serial workers, two warmup samples, no latency pass/fail thresholds. Sample percentiles describe complete batches, not individual operations. Request-level HTTP targets use a separate wall-time throughput metric. Compare on the same otherwise-idle machine/runtime with identical sample counts; 20 samples is exploratory, use 100+ for tail analysis. OS-reported peak RSS includes fixture/import/warmup cost and can include reaped descendants; it is not aggregate process-tree memory. Coverage describes representative hot paths, never complete product coverage.',
    imageOnlyManifests: [
      {
        path: 'services/sandbox-runtime/document-node/package.json',
        status: 'not-measured',
        remaining:
          'Installed into runtime image only; document conversion requires container fixture workloads.',
      },
    ],
    workspaces: await workspaceInventory(measured, measuredHttp),
    measurements,
    failures,
    interrupted,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) {
    const destination = resolve(values.output);
    // Require an existing parent; never invent directories inside a checkout.
    assert.ok(
      (await stat(dirname(destination))).isDirectory(),
      'Report parent must exist',
    );
    await writeFile(destination, json);
    console.error(`Report: ${destination}`);
  } else console.log(json);
  if (interrupted) process.exitCode = 130;
  else if (failures) process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  await rm(directory, { recursive: true, force: true });
}
