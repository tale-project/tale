import assert from 'node:assert/strict';

export function benchmarkMode(env) {
  if (env.BENCH_EVENT_NAME === 'workflow_dispatch') {
    assert(
      ['diagnostic', 'protocol'].includes(env.BENCH_REQUESTED_MODE),
      'Unknown requested browser mode',
    );
    return env.BENCH_REQUESTED_MODE;
  }
  assert.equal(
    env.BENCH_EVENT_NAME,
    'pull_request',
    'Unrecognized browser admission',
  );
  const labels = JSON.parse(env.BENCH_LABELS ?? 'null');
  assert(
    Array.isArray(labels) && labels.every((label) => typeof label === 'string'),
  );
  const selected = [
    ['benchmark:task-board', 'diagnostic'],
    ['benchmark:browser-protocol', 'protocol'],
  ].filter(([label]) => labels.includes(label));
  assert.equal(
    selected.length,
    1,
    'Exactly one browser benchmark mode must be selected',
  );
  return selected[0][1];
}

/** One explicit launch plan prevents a protocol admission falling through to
 * bulk fixture seeding or the app's cold/dialog measurements. */
export function measurementPlan(mode) {
  assert(['diagnostic', 'protocol'].includes(mode), 'Unknown measured mode');
  return mode === 'protocol'
    ? Object.freeze({
        seedTasks: false,
        script: 'protocol.ts',
        timeoutMs: 180_000,
      })
    : Object.freeze({
        seedTasks: true,
        script: 'capture.ts',
        timeoutMs: 600_000,
      });
}
