// reset-keeps-backups (design D-28a, R-05, R3-22): `tale reset --all` deletes
// the data volumes, and with them every native snapshot they held, so it
// first archives the newest snapshot set into the backups volume, which it
// keeps. After the reset a deploy makes fresh, empty volumes (a first deploy
// after a recorded reset), and the archived set restores the data the stack
// held before.

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { expectCode, record } from '../harness';
import {
  backupNow,
  colourOf,
  label,
  loadWorkspace,
  markers,
  runningRelease,
  serving,
  snapshotIds,
  tale,
  volumesOf,
  workspaceDeployed,
  writeMarker,
} from '../workspace';

setDefaultTimeout(60 * 60_000);
const w = loadWorkspace();

describe('reset-keeps-backups', () => {
  test('after reset --all the archived newest set restores into a fresh deploy', async () => {
    await workspaceDeployed(w);
    const release = runningRelease(w);
    writeMarker(w, label('reset-kept'));
    const id = backupNow(w);
    const volumesBefore = volumesOf(w);

    const reset = expectCode(
      tale(w, ['reset', '--all', '--force'], { release }),
      0,
    );
    const volumesAfterReset = volumesOf(w);
    const listedAfterReset = snapshotIds(w);

    const deploy = expectCode(
      tale(w, ['deploy', '--yes', '--skip-backup'], { release }),
      0,
    );
    await serving(w);
    const fresh = markers(w);

    const restore = expectCode(
      tale(w, ['restore', id, '--stop', '--yes'], { release }),
      0,
    );
    await serving(w);
    const restored = markers(w);

    record(w.lab, 'reset-keeps-backups', {
      id,
      volumesBefore,
      volumesAfterReset,
      listedAfterReset,
      resetSaid: (reset.stdout + reset.stderr).slice(-1000),
      deployMs: deploy.ms,
      colour: colourOf(w),
      freshMarkers: fresh,
      restoreMs: restore.ms,
      restoredMarkers: restored,
    });

    // The reset kept the backups volume alone, and the set it archived.
    expect(volumesAfterReset).toContain('backups');
    expect(volumesBefore).toContain('db-data');
    expect(volumesAfterReset).not.toContain('db-data');
    expect(volumesAfterReset).not.toContain('object-store-data');
    expect(listedAfterReset).toContain(id);
    // The deploy after the reset started from empty data …
    expect(fresh).toEqual([]);
    // … and the archived set brought the data back.
    expect(restored).toContain(label('reset-kept'));
  });
});
