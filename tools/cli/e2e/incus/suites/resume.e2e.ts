// resume: the CLI killed in each phase of a flip and of an in-place roll
// (SIGKILL: no handler runs, the lock is left to a dead process), and the
// next `tale deploy` finishes what it began (design 7.3, D-07). The journal
// names the unfinished flip, `tale status` reports it, the next run resumes
// it from its phase, and the stack ends with one colour, every replica
// admitted, no marker left set and nothing of the retired colour behind.

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { expectCode, record } from '../harness';
import {
  colourOf,
  journalOf,
  liveRows,
  loadWorkspace,
  runningRelease,
  serving,
  statusOf,
  tale,
  taleKilled,
  workspaceDeployed,
  workspaceInstances,
} from '../workspace';

setDefaultTimeout(2 * 60 * 60_000);
const w = loadWorkspace();

/** The stack after a resumed run: one colour, every replica admitted, no
 * marker or flip left in the journal. */
async function converged(label: string) {
  await serving(w);
  const status = statusOf(w);
  const colour = status.activeColor;
  const other = colour === 'blue' ? status.green : status.blue;
  const switched = [
    ...liveRows(status, 'platform'),
    ...liveRows(status, 'backend-api'),
  ];
  const journal = journalOf(w) as unknown as {
    flip?: unknown;
    withdrawn?: unknown[];
  } | null;
  const colours = new Set(
    workspaceInstances(w)
      .map((instance) => instance.colour)
      .filter((value): value is string => value !== null),
  );
  return {
    label,
    colour,
    colours: [...colours].sort(),
    otherColourRows: other.length,
    admitted: switched.map((row) => `${row.service}: ${row.admission}`),
    allAdmitted:
      switched.length > 0 &&
      switched.every((row) => row.admission === 'admitted'),
    flip: journal?.flip ?? null,
    withdrawn: journal?.withdrawn?.length ?? 0,
    notices: status.notices,
  };
}

describe('resume', () => {
  const outcomes: Record<string, unknown>[] = [];

  const withdrawnCount = () =>
    (journalOf(w) as unknown as { withdrawn?: unknown[] } | null)?.withdrawn
      ?.length ?? 0;
  // Where a flip is cut: while its colour comes up; right after it is
  // admitted (the journal turns to retiring before any marker is set: the
  // two records are written back to back); and with the old colour's
  // replicas withdrawn, before they are stopped.
  const cuts = [
    {
      label: 'starting',
      phase: 'starting',
      at: (phase: string | undefined) => phase === 'starting',
    },
    {
      label: 'admitted',
      phase: 'retiring',
      at: (phase: string | undefined) =>
        phase === 'retiring' && withdrawnCount() === 0,
    },
    {
      label: 'withdrawn',
      phase: 'retiring',
      at: (phase: string | undefined) =>
        phase === 'retiring' && withdrawnCount() > 0,
    },
  ] as const;

  for (const cut of cuts)
    test(`a flip killed ${cut.label === 'withdrawn' ? 'with the old colour withdrawn' : `in its ${cut.label} phase`} is finished by the next deploy`, async () => {
      await workspaceDeployed(w);
      const release = runningRelease(w);
      const from = colourOf(w);
      const killed = await taleKilled(
        w,
        ['deploy', '--yes', '--skip-backup'],
        () =>
          cut.at(journalOf(w)?.flip?.phase)
            ? `the flip reached ${cut.label}`
            : null,
        { release, pollMs: 2 },
      );
      const pending = journalOf(w)?.flip ?? null;
      const noticed = statusOf(w).notices;
      const resumed = expectCode(
        tale(w, ['deploy', '--yes', '--skip-backup'], { release }),
        0,
      );
      const end = await converged(cut.label);
      outcomes.push({
        ...end,
        killed: killed.killed,
        pending,
        noticed,
        resumedMs: resumed.ms,
      });
      record(w.lab, 'resume', { outcomes });
      expect(killed.killed).toBe(`the flip reached ${cut.label}`);
      expect(pending?.phase).toBe(cut.phase);
      expect(noticed.length).toBeGreaterThan(0);
      expect(resumed.stdout + resumed.stderr).toContain(
        'Resuming the interrupted flip',
      );
      expect(end.colour).toBe(pending?.promoting ?? null);
      expect(end.colour).not.toBe(from);
      expect(end.colours).toEqual([end.colour ?? '']);
      expect(end.otherColourRows).toBe(0);
      expect(end.allAdmitted).toBe(true);
      expect(end.flip).toBeNull();
      expect(end.withdrawn).toBe(0);
    });

  test('an in-place roll killed with a replica withdrawn is finished by the next deploy', async () => {
    await workspaceDeployed(w);
    // An in-place roll replaces what changed: the backend moves to the
    // other release.
    const release = runningRelease(w) === 0 ? 1 : 0;
    const from = colourOf(w);
    const withdrawn = () => withdrawnCount() > 0;
    const killed = await taleKilled(
      w,
      ['deploy', '--services', 'backend-api', '--yes', '--skip-backup'],
      () => (withdrawn() ? 'a replica was withdrawn' : null),
      { release, pollMs: 5 },
    );
    const left = withdrawn();
    const resumed = expectCode(
      tale(
        w,
        ['deploy', '--services', 'backend-api', '--yes', '--skip-backup'],
        { release },
      ),
      0,
    );
    const end = await converged('roll');
    outcomes.push({
      ...end,
      killed: killed.killed,
      withdrawnLeft: left,
      resumedMs: resumed.ms,
    });
    record(w.lab, 'resume', { outcomes });
    expect(killed.killed).toBe('a replica was withdrawn');
    expect(left).toBe(true);
    expect(end.colour).toBe(from);
    expect(end.colours).toEqual([from ?? '']);
    expect(end.allAdmitted).toBe(true);
    expect(end.withdrawn).toBe(0);
  });
});
