import assert from 'node:assert/strict';

export const protocolPlan = Object.freeze({
  fillMs: 45_000,
  target: 0.9,
  maximum: 0.98,
  marksPerBatch: 1024,
  nameBytes: 8192,
  completionMs: 15_000,
  lateObservationMs: 45_000,
  processMs: 180_000,
});

/** Occupancy is the control target; it does not reproduce the app's event mix
 * and cannot establish the cause of the app's timeout. No adaptive retries. */
export async function fillProtocolBuffer(io: {
  now: () => number;
  emitBatch: (index: number) => Promise<void>;
  nextUsage: () => Promise<number>;
  checkpoint: (value: {
    batches: number;
    occupancy: number;
    at: number;
  }) => Promise<void>;
}) {
  const deadline = io.now() + protocolPlan.fillMs;
  const bounded = async <T>(operation: () => Promise<T>) => {
    const remaining = deadline - io.now();
    assert(remaining > 0, 'Protocol fill exceeded45seconds');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Protocol fill exceeded45seconds')),
            remaining,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  let batches = 0;
  for (;;) {
    assert(io.now() < deadline, 'Protocol fill exceeded45seconds');
    await bounded(() => io.emitBatch(batches));
    batches += 1;
    const occupancy = await bounded(io.nextUsage);
    assert(
      Number.isFinite(occupancy) && occupancy >= 0 && occupancy <= 1,
      'Malformed trace buffer occupancy',
    );
    await bounded(() => io.checkpoint({ batches, occupancy, at: io.now() }));
    assert(io.now() < deadline, 'Protocol fill exceeded45seconds');
    assert(
      occupancy <= protocolPlan.maximum,
      'Control overshot its predeclared occupancy range',
    );
    if (occupancy >= protocolPlan.target) return { batches, occupancy };
  }
}
