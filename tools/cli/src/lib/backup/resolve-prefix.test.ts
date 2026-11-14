import { beforeEach, describe, expect, test } from 'bun:test';

import { setProjectId } from '../project/project-context';
import { FakeRuntime } from '../runtime/fake-runtime';
import { resolveSnapshotPrefix } from './resolve-prefix';

describe('the namespace snapshots live in', () => {
  beforeEach(() => setProjectId('demo'));

  test('Docker: the production prefix wins over the dev one; none without a data volume', async () => {
    const runtime = new FakeRuntime();
    expect(await resolveSnapshotPrefix(runtime)).toBeNull();
    runtime.seedVolume('demo_backups');
    expect(await resolveSnapshotPrefix(runtime)).toBeNull();
    runtime.seedVolume('demo-dev_db-data');
    expect(await resolveSnapshotPrefix(runtime)).toBe('demo-dev_');
    runtime.seedVolume('demo_db-data');
    expect(await resolveSnapshotPrefix(runtime)).toBe('demo_');
  });

  test('Incus: the project, once a data volume or the backups volume alone exists (after reset --all, R-05)', async () => {
    const runtime = new FakeRuntime({ engine: 'incus' });
    expect(await resolveSnapshotPrefix(runtime)).toBeNull();
    runtime.seedVolume('backups');
    expect(await resolveSnapshotPrefix(runtime)).toBe('');
  });
});
