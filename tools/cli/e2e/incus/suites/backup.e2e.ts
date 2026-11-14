// backup: the workspace's data through `tale backup` on Incus (design D-28,
// D-28a, D-29, 10): a native snapshot set and a restore of it, an archived
// set exported to one file and imported back under a check of its sha256,
// and a prune of the volumes restores set aside that keeps every listed
// snapshot restorable. The data is a row the suite writes into the
// application database, read back after each step; the stack serves through
// its edge after each restore.

import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expectCode, record } from '../harness';
import {
  backupNow,
  label,
  loadWorkspace,
  markers,
  serving,
  snapshotIds,
  tale,
  volumesOf,
  workspaceDeployed,
  writeMarker,
} from '../workspace';

setDefaultTimeout(60 * 60_000);
const w = loadWorkspace();
const facts: Record<string, unknown> = {};

describe('backup', () => {
  test('a native snapshot restores the data it holds, and the stack serves again', async () => {
    await workspaceDeployed(w);
    writeMarker(w, label('backup-native-before'));
    const id = backupNow(w);
    writeMarker(w, label('backup-native-after'));
    expect(snapshotIds(w)).toContain(id);
    const restore = expectCode(tale(w, ['restore', id, '--stop', '--yes']), 0);
    await serving(w);
    const held = markers(w);
    facts.native = { id, restoreMs: restore.ms, markers: held };
    record(w.lab, 'backup', facts);
    expect(held).toContain(label('backup-native-before'));
    expect(held).not.toContain(label('backup-native-after'));
  });

  test('an archived snapshot exports to one file, imports back, and restores', async () => {
    await workspaceDeployed(w);
    writeMarker(w, label('backup-archive-before'));
    const id = backupNow(w, { archive: true });
    writeMarker(w, label('backup-archive-after'));
    const file = join(w.lab.dir, `snapshot-${id}.tar`);
    expectCode(tale(w, ['backup', 'export', id, '--to', file]), 0);
    expect(existsSync(file)).toBe(true);
    const bytes = statSync(file).size;
    // Imported over a set that is still there, the import refuses or
    // replaces it whole; either way the id stays listed and restorable.
    const imported = tale(w, ['backup', 'import', file]);
    expect(snapshotIds(w)).toContain(id);
    const restore = expectCode(tale(w, ['restore', id, '--stop', '--yes']), 0);
    await serving(w);
    const held = markers(w);
    facts.archive = {
      id,
      bytes,
      importCode: imported.code,
      importSaid: (imported.stdout + imported.stderr).slice(-600),
      restoreMs: restore.ms,
      markers: held,
    };
    record(w.lab, 'backup', facts);
    expect(bytes).toBeGreaterThan(0);
    expect(held).toContain(label('backup-archive-before'));
    expect(held).not.toContain(label('backup-archive-after'));
  });

  test('prune deletes only set-aside volumes no listed snapshot lives on', async () => {
    await workspaceDeployed(w);
    const listed = snapshotIds(w);
    const before = volumesOf(w);
    const dry = expectCode(tale(w, ['backup', 'prune', '--dry-run']), 0);
    const pruned = expectCode(tale(w, ['backup', 'prune', '--yes']), 0);
    const after = volumesOf(w);
    const stillListed = snapshotIds(w);
    facts.prune = {
      listed,
      setAsideBefore: before.filter((name) => name.includes('.pre-restore-')),
      setAsideAfter: after.filter((name) => name.includes('.pre-restore-')),
      dryRun: (dry.stdout + dry.stderr).slice(-800),
      pruned: (pruned.stdout + pruned.stderr).slice(-800),
    };
    record(w.lab, 'backup', facts);
    expect(stillListed).toEqual(listed);
    // Every data volume is still there.
    expect(after.filter((name) => !name.includes('.pre-restore-'))).toEqual(
      before.filter((name) => !name.includes('.pre-restore-')),
    );
    // The newest snapshot still restores.
    const newest = stillListed.at(-1);
    expect(newest).toBeDefined();
    expectCode(tale(w, ['restore', newest ?? '', '--stop', '--yes']), 0);
    await serving(w);
  });
});
