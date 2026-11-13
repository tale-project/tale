// restore-history (design D-29, R-06, R3-08, R3-22): a restore sets the
// volumes it replaces aside, history and all — the volume is detached,
// renamed, a fresh one copied from the snapshot and attached — so a restore,
// a deploy, and then a restore to an older snapshot still finds that older
// snapshot on the volume set aside. The CLI is killed after each step of a
// restore: while `restore-pending` is journaled, `tale deploy` and
// `tale start` refuse; `tale restore --resume` and `--abort` both converge;
// and at no point does a data volume exist empty (every restore ends with the
// data of the snapshot or of the volume before it, never with nothing).

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { expectCode, record } from '../harness';
import {
  backupNow,
  journalOf,
  label,
  loadWorkspace,
  markers,
  runningRelease,
  serving,
  tale,
  taleKilled,
  volumesOf,
  workspaceDeployed,
  writeMarker,
} from '../workspace';

setDefaultTimeout(3 * 60 * 60_000);
const w = loadWorkspace();
const STEPS = [
  'pending',
  'stopped',
  'detached',
  'renamed',
  'copied',
  'attached',
  'started',
] as const;
const facts: Record<string, unknown> = {};

/** This suite's rows (the database carries other suites' rows too). */
const history = () =>
  markers(w).filter(
    (row) => row.startsWith('history-') && row.endsWith(label('')),
  );

/** The furthest step any volume of the pending restore reached. */
function furthest(): number {
  const steps = Object.values(journalOf(w)?.restorePending?.steps ?? {});
  return Math.max(
    -1,
    ...steps.map((step) => STEPS.indexOf(step as (typeof STEPS)[number])),
  );
}

describe('restore-history', () => {
  let older = '';
  let newer = '';

  test('a restore, a deploy, then a restore to an older snapshot', async () => {
    await workspaceDeployed(w);
    const release = runningRelease(w);
    writeMarker(w, label('history-1'));
    older = backupNow(w);
    writeMarker(w, label('history-2'));
    newer = backupNow(w);
    writeMarker(w, label('history-3'));

    expectCode(tale(w, ['restore', newer, '--stop', '--yes'], { release }), 0);
    await serving(w);
    const afterNewer = history();
    const setAside = volumesOf(w).filter((name) =>
      name.includes('.pre-restore-'),
    );
    expectCode(tale(w, ['deploy', '--yes', '--skip-backup'], { release }), 0);
    await serving(w);
    expectCode(tale(w, ['restore', older, '--stop', '--yes'], { release }), 0);
    await serving(w);
    const afterOlder = history();
    facts.history = { older, newer, afterNewer, setAside, afterOlder };
    record(w.lab, 'restore-history', facts);
    expect(afterNewer).toEqual([label('history-1'), label('history-2')]);
    expect(setAside.length).toBeGreaterThan(0);
    expect(afterOlder).toEqual([label('history-1')]);
  });

  // Killed after each step; resumed and aborted in turn, so both ways out
  // are taken from early and late steps alike.
  const cuts = [
    'stopped',
    'detached',
    'renamed',
    'copied',
    'attached',
  ] as const;
  cuts.forEach((step, index) => {
    const way = index % 2 === 0 ? '--resume' : '--abort';
    test(`killed once a volume is ${step}: deploy and start refuse, ${way} converges`, async () => {
      await workspaceDeployed(w);
      expect(newer).not.toBe('');
      const release = runningRelease(w);
      const before = markers(w);
      const killed = await taleKilled(
        w,
        ['restore', newer, '--stop', '--yes'],
        () =>
          furthest() >= STEPS.indexOf(step) ? `a volume reached ${step}` : null,
        { release, pollMs: 2 },
      );
      const pending = journalOf(w)?.restorePending ?? null;
      const volumesWhilePending = volumesOf(w);
      const deploy = tale(w, ['deploy', '--yes', '--skip-backup'], { release });
      const start = tale(w, ['start'], { release });
      // The refusals made nothing: no data volume was made again, empty.
      const volumesAfterRefusals = volumesOf(w);
      const out = expectCode(
        tale(w, ['restore', way, '--yes'], { release }),
        0,
      );
      // Whatever the restore left stopped comes back with `tale start`.
      expectCode(tale(w, ['start'], { release }), 0);
      await serving(w);
      const after = markers(w);
      const volumesAfter = volumesOf(w);
      const outcome = {
        step,
        way,
        killed: killed.killed,
        steps: pending?.steps ?? null,
        volumesWhilePending,
        volumesAfterRefusals,
        deployCode: deploy.code,
        deploySaid: (deploy.stdout + deploy.stderr).slice(-400),
        startCode: start.code,
        startSaid: (start.stdout + start.stderr).slice(-400),
        endedSaid: (out.stdout + out.stderr).slice(-400),
        before,
        after,
        pendingAfter: journalOf(w)?.restorePending ?? null,
      };
      facts[`cut-${step}`] = outcome;
      record(w.lab, 'restore-history', facts);

      expect(killed.killed).toBe(`a volume reached ${step}`);
      expect(pending).not.toBeNull();
      expect(deploy.code).not.toBe(0);
      expect(start.code).not.toBe(0);
      expect(volumesAfterRefusals).toEqual(volumesWhilePending);
      expect(outcome.pendingAfter).toBeNull();
      expect(volumesAfter).toContain('db-data');
      // Resumed: the snapshot's data. Aborted: the data from before.
      if (way === '--resume')
        expect(
          after.filter(
            (row) => row.startsWith('history-') && row.endsWith(label('')),
          ),
        ).toEqual([label('history-1'), label('history-2')]);
      else expect(after).toEqual(before);
    });
  });
});
