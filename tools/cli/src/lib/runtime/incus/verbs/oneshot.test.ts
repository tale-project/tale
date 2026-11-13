import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { helperDevices, helperName, reapHelpers, runOneShot } from './oneshot';
import {
  POOL,
  seedStackInstance,
  seedStackVolume,
  STACK,
  verbsFixture,
  WITH_TIMEOUT,
  type VerbsFixture,
} from './verbs-fixture';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

let fixture: VerbsFixture;
const HELPER_IMAGE = 'tale-proxy-0123456789abcdef0123456789abcdef';

beforeEach(() => {
  fixture = verbsFixture();
  fixture.fake.addImage(HELPER_IMAGE);
});
afterEach(() => {
  fixture.remove();
});

describePosix('one-shot helpers', () => {
  test('are named job-<purpose>-<8 hex>, and a bad purpose is refused', () => {
    expect(helperName('snapshot')).toMatch(/^job-snapshot-[0-9a-f]{8}$/);
    expect(helperName()).toMatch(/^job-job-[0-9a-f]{8}$/);
    expect(() => helperName('Bad Purpose')).toThrow('Not a job purpose');
  });

  test('mount the job volumes, and nothing else', () => {
    expect(
      helperDevices(POOL, {
        mounts: [
          { volume: 'db-data', target: '/data', readOnly: true },
          { volume: 'backups', target: '/backup' },
        ],
      }),
    ).toEqual({
      'job-volume-0': {
        type: 'disk',
        pool: POOL,
        source: 'db-data',
        path: '/data',
        readonly: 'true',
      },
      'job-volume-1': {
        type: 'disk',
        pool: POOL,
        source: 'backups',
        path: '/backup',
      },
    });
  });

  test('run the job from tale-proxy by exec, keep its exit code, and are deleted', async () => {
    seedStackVolume(fixture.fake, 'db-data');
    const seen: unknown[] = [];
    fixture.fake.exec = async (call, io) => {
      seen.push({
        instance: call.instance.name,
        config: call.instance.config,
        devices: call.instance.devices,
        command: call.command,
        stdin: new TextDecoder().decode(await io.stdin()),
        mode: call.mode,
      });
      io.write(2, 'exit 3');
      return 3;
    };
    const result = await runOneShot(
      fixture.context,
      {
        image: 'alpine:3.22',
        purpose: 'snapshot',
        mounts: [{ volume: 'db-data', target: '/data', readOnly: true }],
        argv: ['sh', '-c', 'cat > /data/x'],
        stdin: 'manifest',
        timeoutS: 30,
      },
      {
        image: HELPER_IMAGE,
        digest: WITH_TIMEOUT,
        pool: POOL,
        active: new Set(),
      },
    );
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'exit 3',
      exitCode: 3,
    });
    expect(seen).toEqual([
      {
        instance: expect.stringMatching(/^job-snapshot-[0-9a-f]{8}$/),
        config: expect.objectContaining({
          'oci.entrypoint': 'sleep 330',
          'user.tale.stack': STACK,
          'user.tale.role': 'helper',
          'user.tale.purpose': 'snapshot',
          'user.tale.image': WITH_TIMEOUT,
        }),
        devices: {
          'job-volume-0': {
            type: 'disk',
            pool: POOL,
            source: 'db-data',
            path: '/data',
            readonly: 'true',
          },
        },
        command: ['sh', '-c', 'cat > /data/x'],
        stdin: 'manifest',
        mode: 'record-output',
      },
    ]);
    const created = fixture.fake.seen('POST /1.0/instances')[0]?.body;
    expect(created).toMatchObject({
      source: { type: 'image', alias: HELPER_IMAGE },
      profiles: ['tale-stack'],
    });
    expect(fixture.fake.names()).toEqual([]);
  });

  test('a helper a crash left is reaped; one running in this process is spared', async () => {
    const config = { 'user.tale.role': 'helper' };
    seedStackInstance(fixture.fake, 'job-snapshot-00000001', { config });
    seedStackInstance(fixture.fake, 'job-snapshot-00000002', {
      config,
      status: 'Stopped',
    });
    seedStackInstance(fixture.fake, 'job-snapshot-00000003', { config });
    fixture.fake.seedInstance(
      'job-other-00000004',
      { 'user.tale.stack': 'another', 'user.tale.role': 'helper' },
      { ephemeral: false },
    );
    seedStackInstance(fixture.fake, 'db');
    expect(
      await reapHelpers(fixture.context, new Set(['job-snapshot-00000003'])),
    ).toEqual(['job-snapshot-00000001', 'job-snapshot-00000002']);
    expect(fixture.fake.names()).toEqual([
      'db',
      'job-other-00000004',
      'job-snapshot-00000003',
    ]);
  });
});
