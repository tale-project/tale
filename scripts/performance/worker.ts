import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { summarize } from './statistics.ts';
import { prepareWorkload } from './workloads.ts';

const [id, sampleArgument, output, fixtureRoot] = process.argv.slice(2);
const samples = Number(sampleArgument);
if (
  !id ||
  !output ||
  !fixtureRoot ||
  !Number.isInteger(samples) ||
  samples < 3 ||
  samples > 1000
) {
  throw new Error(
    'Worker expects workload id, 3..1000 samples and an output file',
  );
}

function collectGarbage() {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  else globalThis.gc?.();
}

const workload = await prepareWorkload(id, fixtureRoot);
let cleanup: Promise<void> | undefined;
const cleanUp = () =>
  (cleanup ??= Promise.resolve().then(() => workload.cleanup?.()));
process.once('SIGTERM', () => {
  void cleanUp().finally(() => process.exit(143));
});
try {
  // Warm JIT, module imports and fixtures before timing. Cold-cache workloads
  // invalidate their own caches for every invocation, including these two.
  await workload.run();
  await workload.run();
  collectGarbage();
  const before = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  let observedRssBytes = before.rss;
  let observedHeapBytes = before.heapUsed;
  const observe = () => {
    const usage = process.memoryUsage();
    observedRssBytes = Math.max(observedRssBytes, usage.rss);
    observedHeapBytes = Math.max(observedHeapBytes, usage.heapUsed);
  };
  const timer = setInterval(observe, 5);
  const durations: number[] = [];
  try {
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await workload.run();
      durations.push(performance.now() - start);
      observe();
    }
  } finally {
    clearInterval(timer);
  }
  const cpu = process.cpuUsage(cpuBefore);
  collectGarbage();
  const after = process.memoryUsage();
  await writeFile(
    output,
    JSON.stringify({
      id,
      status: 'measured',
      runtime:
        typeof Bun === 'undefined'
          ? `node ${process.versions.node}`
          : `bun ${Bun.version}`,
      description: workload.description,
      unit: workload.unit,
      warmupSamples: 2,
      details: workload.details?.(),
      ...summarize(durations, workload.operations),
      cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 },
      memory: {
        beforeBytes: before,
        afterGcBytes: after,
        retainedHeapDeltaBytes: after.heapUsed - before.heapUsed,
        observedRssBytes,
        observedHeapBytes,
        scope:
          'Worker process.memoryUsage observations only; sampled every 5ms and after each batch, so synchronous peaks can be missed. These observations exclude subprocess memory; the separate OS-reported processPeakRssBytes may include reaped descendants. Post-GC delta is not a leak proof.',
      },
    }),
  );
} finally {
  await cleanUp();
}
