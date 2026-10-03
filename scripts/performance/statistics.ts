/** Nearest-rank percentiles; keep raw samples so reports can be re-analysed. */
export function summarize(samplesMs: number[], operationsPerSample: number) {
  if (
    samplesMs.length === 0 ||
    samplesMs.some((sample) => !Number.isFinite(sample) || sample <= 0) ||
    !Number.isSafeInteger(operationsPerSample) ||
    operationsPerSample <= 0
  ) {
    throw new Error(
      'Expected positive finite durations and an operation count',
    );
  }
  const sorted = samplesMs.toSorted((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  const totalMs = samplesMs.reduce((total, sample) => total + sample, 0);
  return {
    samples: samplesMs.length,
    operationsPerSample,
    totalMs,
    meanMs: totalMs / samplesMs.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    operationsPerSecond:
      (operationsPerSample * samplesMs.length * 1000) / totalMs,
    samplesMs,
  };
}
