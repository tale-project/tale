// services and rollback (design 7.2, 7.3, 15.5): `tale deploy --services`
// rolls the live colour's replicas of the roles it names one at a time, while
// the others serve, and leaves every other instance alone; `tale rollback`
// flips back to the previous release on the other colour. Both run under
// load through the edge, and neither costs a visitor a failed request.

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { expectCode, record } from '../harness';
import {
  attributedLoad,
  colourOf,
  edgeOf,
  liveRows,
  loadWorkspace,
  replicasOf,
  runningRelease,
  serving,
  stalls,
  statusOf,
  tale,
  taleAsync,
  viaEdge,
  workspaceDeployed,
  workspaceInstances,
} from '../workspace';

setDefaultTimeout(60 * 60_000);
const w = loadWorkspace();
const [N, NEXT] = w.releases;

function underLoad() {
  const edge = edgeOf(w);
  const epoch = performance.now();
  return attributedLoad(
    [
      { name: 'platform', ...viaEdge(w, '/api/health', edge) },
      { name: 'backend', ...viaEdge(w, '/api/health/ready', edge) },
      { name: 'web', ...viaEdge(w, '/', edge) },
    ],
    { intervalMs: 50, epoch },
  );
}

const uuids = () =>
  Object.fromEntries(
    workspaceInstances(w).map((instance) => [instance.name, instance.uuid]),
  );

describe('services', () => {
  test('--services platform rolls the live colour one replica at a time, under load, and nothing else', async () => {
    await workspaceDeployed(w);
    const colour = colourOf(w);
    const before = uuids();
    const load = underLoad();
    await Bun.sleep(2_000);
    // An in-place roll replaces what changed: the platform moves to the
    // other release (the operator's way to update one role).
    const run = expectCode(
      await taleAsync(
        w,
        ['deploy', '--services', 'platform', '--yes', '--skip-backup'],
        {
          release: runningRelease(w) === 0 ? 1 : 0,
        },
      ),
      0,
    );
    await Bun.sleep(2_000);
    const answers = await load.stop();
    const after = uuids();
    const platforms = replicasOf(w, 'platform', colour ?? '').map(
      (instance) => instance.name,
    );
    const changed = Object.keys(after)
      .filter((name) => before[name] !== after[name])
      .sort();
    const failed = answers.filter((answer) => !answer.ok);
    record(w.lab, 'services', {
      ms: run.ms,
      changed,
      platforms,
      requests: answers.length,
      slowest: [...answers]
        .sort((left, right) => right.ms - left.ms)
        .slice(0, 20),
      stalls: stalls(answers),
      failed: failed.slice(0, 40),
    });
    expect(colourOf(w)).toBe(colour);
    expect(platforms.length).toBeGreaterThan(1);
    expect(changed).toEqual([...platforms].sort());
    expect(stalls(answers)).toEqual([]);
    expect(failed).toEqual([]);
  });
});

describe('rollback', () => {
  test(`tale rollback flips from ${NEXT} back to ${N}, under load`, async () => {
    await workspaceDeployed(w);
    // The workspace runs N+1 with N recorded as the release before it.
    const status = statusOf(w);
    if (
      liveRows(status, 'platform')[0]?.version !== NEXT ||
      status.previousVersion !== N
    )
      expectCode(
        tale(w, ['deploy', '--yes', '--skip-backup'], { release: 1 }),
        0,
      );
    await serving(w);
    const colour = colourOf(w);
    expect(statusOf(w).previousVersion).toBe(N);
    const load = underLoad();
    await Bun.sleep(2_000);
    const run = expectCode(
      await taleAsync(w, ['rollback', '--yes'], { release: 1 }),
      0,
    );
    await Bun.sleep(2_000);
    const answers = await load.stop();
    const after = statusOf(w);
    const switched = [
      ...liveRows(after, 'platform'),
      ...liveRows(after, 'backend-api'),
    ];
    const failed = answers.filter((answer) => !answer.ok);
    record(w.lab, 'rollback', {
      ms: run.ms,
      from: colour,
      to: after.activeColor,
      live: switched,
      requests: answers.length,
      stalls: stalls(answers),
      failed: failed.slice(0, 40),
    });
    expect(after.activeColor).not.toBe(colour);
    expect(switched.length).toBeGreaterThan(0);
    expect(switched.every((row) => row.version === N)).toBe(true);
    expect(switched.every((row) => row.admission === 'admitted')).toBe(true);
    expect(stalls(answers)).toEqual([]);
    expect(failed).toEqual([]);
  });
});
