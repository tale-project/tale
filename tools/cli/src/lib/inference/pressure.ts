import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { exec } from '../docker/exec';

export const memoryObservationSchema = z.strictObject({
  pressure: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  swapUsedBytes: z.number().int().nonnegative().safe(),
  swapOutPages: z.number().int().nonnegative().safe(),
});
export type MemoryObservation = z.infer<typeof memoryObservationSchema>;
export const memoryProofSchema = z
  .strictObject({
    sampled: z.literal(true),
    intervalMs: z.literal(2000),
    samples: z.number().int().min(2),
    noPressureObserved: z.literal(true),
    noSwapGrowthObserved: z.literal(true),
    noSwapOutsObserved: z.literal(true),
    baselineSwapUsedBytes: z.number().int().nonnegative().safe(),
    maximumSampledSwapUsedBytes: z.number().int().nonnegative().safe(),
    finalSwapUsedBytes: z.number().int().nonnegative().safe(),
    baselineSwapOutPages: z.number().int().nonnegative().safe(),
    finalSwapOutPages: z.number().int().nonnegative().safe(),
    continuousPressureMonitoring: z.literal(false),
  })
  .refine(
    (proof) =>
      proof.maximumSampledSwapUsedBytes === proof.baselineSwapUsedBytes &&
      proof.finalSwapUsedBytes <= proof.maximumSampledSwapUsedBytes &&
      proof.finalSwapOutPages === proof.baselineSwapOutPages,
    'Memory proof contradicts its no-growth observation.',
  );

/** Read-only macOS sysctls. XNU exports dispatch masks (normal1/warn2/critical4),
 * not its internal 0/1/2/3 enum. Missing/unknown observations cannot admit a load. */
export async function observeMemoryPressure(
  run: typeof exec = exec,
): Promise<MemoryObservation> {
  const options = {
    silent: true,
    timeout: 10,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
  };
  const [pressure, swap, vm] = await Promise.all([
    run(
      '/usr/sbin/sysctl',
      ['-n', 'kern.memorystatus_vm_pressure_level'],
      options,
    ),
    run('/usr/sbin/sysctl', ['-n', 'vm.swapusage'], options),
    run('/usr/bin/vm_stat', [], options),
  ]);
  // The no-interval form prints cumulative VM_STATISTICS64 counters. Net swap
  // can remain unchanged while pages churn, so usage alone cannot admit a load.
  const swapouts = [...vm.stdout.matchAll(/^Swapouts:\s+(\d+)\.\s*$/gm)];
  const used = /(?:^|\s)used\s*=\s*(\d+(?:\.\d+)?)([MGT])(?:\s|$)/.exec(
    swap.stdout,
  );
  const factors: Record<string, number> = {
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
  };
  const parsed = memoryObservationSchema.safeParse({
    pressure: Number(pressure.stdout.trim()),
    swapUsedBytes: used
      ? Math.round(Number(used[1]) * factors[used[2]])
      : undefined,
    swapOutPages: swapouts.length === 1 ? Number(swapouts[0]?.[1]) : undefined,
  });
  if (
    !pressure.success ||
    !swap.success ||
    !vm.success ||
    vm.stdout.length > 16384 ||
    !parsed.success
  )
    throw preconditionError(
      'The target could not prove its macOS memory pressure, swap usage and swap-out counter. Benchmark admission is held.',
    );
  return parsed.data;
}

/** A bounded sampled acceptance check, not a claim of steady-state performance
 * or continuous kernel tracing. It never changes VM policy or clears caches. */
export async function withMemoryAdmission<T>(
  work: () => Promise<T>,
  observe: () => Promise<MemoryObservation> = observeMemoryPressure,
) {
  const before = memoryObservationSchema.parse(await observe());
  if (before.pressure !== 1)
    throw preconditionError(
      'macOS already reports memory pressure. Model benchmark admission is held.',
    );
  let latest = before;
  let maximum = before.swapUsedBytes;
  let samples = 1;
  let failed = false;
  let pending: Promise<void> | undefined;
  const sample = async () => {
    try {
      latest = memoryObservationSchema.parse(await observe());
      maximum = Math.max(maximum, latest.swapUsedBytes);
      samples++;
      failed ||=
        latest.pressure !== 1 ||
        latest.swapUsedBytes > before.swapUsedBytes ||
        latest.swapOutPages !== before.swapOutPages;
    } catch {
      failed = true;
    }
  };
  const timer = setInterval(() => {
    if (!pending)
      pending = sample().finally(() => {
        pending = undefined;
      });
  }, 2000);
  let result: T;
  try {
    result = await work();
  } finally {
    clearInterval(timer);
    await pending;
    await sample();
  }
  if (failed)
    throw preconditionError(
      'The bounded inference workload observed memory pressure, swap growth or unavailable telemetry. The node is not admitted for routing.',
    );
  return {
    result,
    memory: memoryProofSchema.parse({
      sampled: true,
      intervalMs: 2000,
      samples,
      noPressureObserved: true,
      noSwapGrowthObserved: true,
      noSwapOutsObserved: true,
      baselineSwapUsedBytes: before.swapUsedBytes,
      maximumSampledSwapUsedBytes: maximum,
      finalSwapUsedBytes: latest.swapUsedBytes,
      baselineSwapOutPages: before.swapOutPages,
      finalSwapOutPages: latest.swapOutPages,
      continuousPressureMonitoring: false,
    }),
  };
}
