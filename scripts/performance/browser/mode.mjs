import assert from 'node:assert/strict';

export function benchmarkMode(env) {
  if (env.BENCH_EVENT_NAME === 'workflow_dispatch') {
    assert(
      ['diagnostic', 'protocol', 'acceptance'].includes(
        env.BENCH_REQUESTED_MODE,
      ),
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
    ['benchmark:task-board-acceptance', 'acceptance'],
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
  assert(
    ['diagnostic', 'protocol', 'acceptance'].includes(mode),
    'Unknown measured mode',
  );
  if (mode === 'acceptance')
    return Object.freeze({
      seedTasks: true,
      script: 'acceptance.ts',
      timeoutMs: 60 * 60_000,
    });
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

/** Predeclared setup+campaign deadline, leaving cleanup/upload margin inside
 * the workflow job. Invalid admissions never receive the longer budget. */
export function sharedBudgetMs(mode) {
  assert(
    ['diagnostic', 'protocol', 'acceptance'].includes(mode),
    'Unknown budget mode',
  );
  return (mode === 'acceptance' ? 75 : 32) * 60_000;
}
