// withdraw-restart (design D-17, D-26, R3-26): a withdrawal marker that root
// made in a replica's sticky /tmp — both markers, in a platform replica and
// in a backend replica — and then the replica restarted outside the CLI. The
// image's entrypoint deletes every marker as root before it drops to the app
// user, so the replica boots, its admission probe passes and the switch
// sends it traffic again; it does not crash-loop on a marker the app user
// cannot remove. The other replicas serve throughout, so a visitor sees no
// failure.

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { record, until } from '../harness';
import {
  attributedLoad,
  colourOf,
  edgeOf,
  execIn,
  incusRestart,
  liveRows,
  loadWorkspace,
  replicasOf,
  stalls,
  statusOf,
  viaEdge,
  WITHDRAWAL_WINDOW_MS,
  workspaceDeployed,
  workspaceInstances,
} from '../workspace';

setDefaultTimeout(30 * 60_000);
const w = loadWorkspace();
const MARKERS = '/tmp/platform-withdrawn /tmp/backend-withdrawn';
/** Each role's admission probe, as the switch asks it. */
const ADMISSION = {
  platform: 'http://127.0.0.1:3000/api/admission',
  'backend-api': 'http://127.0.0.1:3005/admission',
} as const;

describe('withdraw-restart', () => {
  for (const role of ['platform', 'backend-api'] as const)
    test(`a ${role} replica restarted with root's markers in /tmp boots and is admitted again`, async () => {
      await workspaceDeployed(w);
      const colour = colourOf(w) ?? '';
      const replica = replicasOf(w, role, colour)[0];
      if (replica === undefined)
        throw new Error(`No ${role} replica in ${colour}.`);
      const edge = edgeOf(w);
      const epoch = performance.now();
      const load = attributedLoad(
        [
          { name: 'platform', ...viaEdge(w, '/api/health', edge) },
          { name: 'backend', ...viaEdge(w, '/api/health/ready', edge) },
        ],
        { intervalMs: 100, epoch },
      );
      // As uid 0, as an exec that is not the CLI's makes them.
      const touched = execIn(
        w,
        replica.name,
        `touch ${MARKERS} && stat -c '%u %a %n' ${MARKERS}`,
        { user: 0 },
      );
      // The markers withdraw it, as a CLI that crashed mid-roll would have
      // left it: once the switch has dropped it, the restart outside the CLI
      // costs a visitor nothing.
      await Bun.sleep(WITHDRAWAL_WINDOW_MS);
      await incusRestart(w, replica.name);
      const admitted = await until(
        `${replica.name} to run and be admitted again`,
        () => {
          const rows = liveRows(statusOf(w), role);
          const instance = workspaceInstances(w).find(
            (entry) => entry.name === replica.name,
          );
          const index = replica.config['user.tale.index'];
          const row = rows.find(
            (entry) =>
              entry.service === role || entry.service === `${role} #${index}`,
          );
          // The probe the switch reads, asked from inside the replica.
          const probe = execIn(
            w,
            replica.name,
            `bun -e 'const r = await fetch("${ADMISSION[role]}"); console.log(r.status)'`,
          ).stdout.trim();
          return instance?.status === 'Running' &&
            row?.admission === 'admitted' &&
            row.status === 'healthy' &&
            probe === '200'
            ? { ...row, probe }
            : undefined;
        },
        { timeoutMs: 10 * 60_000, intervalMs: 3_000 },
      );
      const left = execIn(w, replica.name, `ls ${MARKERS} 2>&1; true`);
      const restarts = workspaceInstances(w).find(
        (entry) => entry.name === replica.name,
      );
      await Bun.sleep(3_000);
      const answers = await load.stop();
      const failed = answers.filter((answer) => !answer.ok);
      record(w.lab, 'withdraw-restart', {
        [role]: {
          replica: replica.name,
          touched: touched.stdout.trim(),
          admitted,
          markersLeft: left.stdout.trim(),
          status: restarts?.status,
          requests: answers.length,
          stalls: stalls(answers),
          failed: failed.slice(0, 20),
        },
      });
      expect(touched.code).toBe(0);
      expect(touched.stdout).toMatch(/^0 \d+ \/tmp\/platform-withdrawn$/m);
      expect(touched.stdout).toMatch(/^0 \d+ \/tmp\/backend-withdrawn$/m);
      expect(left.stdout).toContain('No such file');
      expect(left.stdout).not.toMatch(/^\/tmp\/(platform|backend)-withdrawn$/m);
      expect(stalls(answers)).toEqual([]);
      expect(failed).toEqual([]);
    });
});
