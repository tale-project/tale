import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { createModuleMocks } from '../../utils/module-mock-fixture';
import { createSnapshot } from './create-snapshot';
import {
  incusBackupFixture,
  type IncusBackupFixture,
} from './incus-backup-fixture';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

const dockerMock = mock();
const execMock = mock();
const ensureVolumesMock = mock();
const volumeExistsMock = mock();
const loggerWarnMock = mock();
const loggerNoticeMock = mock();

// Bun's module mocks are process-wide: each one is put back once this suite
// ends, so a later suite in the same process meets the real module.
const { mockModule } = createModuleMocks(import.meta.dir);
await mockModule('../docker/docker', () => ({ docker: dockerMock }));
await mockModule('../docker/exec', () => ({ exec: execMock }));
await mockModule('../docker/ensure-volumes', () => ({
  ensureVolumes: ensureVolumesMock,
  volumeExists: volumeExistsMock,
}));
await mockModule('../../utils/logger', () => ({
  info: mock(),
  error: mock(),
  warn: loggerWarnMock,
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
  notice: loggerNoticeMock,
  table: mock(),
}));

const SHA = 'a'.repeat(64);

/** A volume user as the pause reads it: healthy, probed every 5 s. */
const HEALTHY_DB = '/p-db healthy 5000000000 10000000000 3';

function ok(stdout = '') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

function failed(stderr: string) {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

/** One `<path>\t<one-line json>` row of the config-store inspection output. */
function connectionRow(slug: string, connection: Record<string, unknown>) {
  return `/data/${slug}/object-storage/connection.json\t${JSON.stringify(connection)}`;
}

const BUNDLED_CONNECTION = {
  region: 'us-east-1',
  endpoint: 'http://object-store:9000',
  forcePathStyle: true,
  bucket: 'tale-blobs',
};

const EXTERNAL_CONNECTION = {
  region: 'eu-central-1',
  endpoint: 'https://s3.eu-central-1.amazonaws.com',
  forcePathStyle: false,
  bucket: 'acme-tale-blobs',
};

/**
 * A full local stack: every snapshot volume exists, the config store answers
 * the inspection with `rows`, and every tar succeeds with a per-volume sha.
 */
function seedLocalStack(rows: string[]) {
  volumeExistsMock.mockResolvedValue(true);
  ensureVolumesMock.mockResolvedValue(true);
  dockerMock.mockImplementation((...args: string[]) => {
    if (args[0] === 'ps') return Promise.resolve(ok(''));
    return Promise.resolve(ok());
  });
  execMock.mockImplementation((_cmd: string, args: string[]) => {
    const script = args[args.length - 1];
    if (script.includes('object-storage/connection.json')) {
      return Promise.resolve(ok(rows.join('\n')));
    }
    const tar = /tar czf \/backup\/[^/]+\/([a-z-]+)\.tar\.gz/.exec(script);
    if (tar) {
      return Promise.resolve(ok(`${SHA}  ${tar[1]}.tar.gz\n4096`));
    }
    return Promise.resolve(ok());
  });
}

function tarredVolumes(): string[] {
  return execMock.mock.calls
    .map((call) =>
      /tar czf \/backup\/[^/]+\/([a-z-]+)\.tar\.gz/.exec(
        call[1][call[1].length - 1],
      ),
    )
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]);
}

afterEach(() => {
  dockerMock.mockReset();
  execMock.mockReset();
  ensureVolumesMock.mockReset();
  volumeExistsMock.mockReset();
  loggerWarnMock.mockReset();
  loggerNoticeMock.mockReset();
});

describe('createSnapshot', () => {
  test('captures the separate knowledge database and makes its archive restorable', async () => {
    seedLocalStack([]);
    volumeExistsMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'p_knowledge-db-data'),
    );
    const manifest = await createSnapshot({
      prefix: 'p_',
      trigger: 'deploy',
      platformVersion: '0.5.16',
    });
    expect(manifest?.volumes['knowledge-db-data']).toEqual({
      sha256: SHA,
      sizeBytes: 4096,
    });
    expect(tarredVolumes()).toEqual(['knowledge-db-data']);
    const { RESTORABLE_ARCHIVES } = await import('./constants');
    expect(RESTORABLE_ARCHIVES).toContain('knowledge-db-data');
  });

  test('pauses volume users, tars, unpauses, and writes the manifest last', async () => {
    // Only db-data exists under the prefix.
    volumeExistsMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'p_db-data'),
    );
    ensureVolumesMock.mockResolvedValue(true);
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] === 'ps') return Promise.resolve(ok('abc123\n'));
      if (args[0] === 'container') return Promise.resolve(ok(HEALTHY_DB));
      return Promise.resolve(ok());
    });
    execMock.mockImplementation((_cmd: string, args: string[]) => {
      const script = args[args.length - 1];
      if (script.includes('tar czf')) {
        return Promise.resolve(ok(`${SHA}  db-data.tar.gz\n123456`));
      }
      return Promise.resolve(ok());
    });

    const manifest = await createSnapshot({
      prefix: 'p_',
      trigger: 'manual',
      platformVersion: '0.9.3',
    });

    expect(manifest).not.toBeNull();
    expect(manifest?.id).toMatch(/^\d{8}-\d{6}-manual$/);
    expect(manifest?.platformVersion).toBe('0.9.3');
    expect(manifest?.volumes['db-data']).toEqual({
      sha256: SHA,
      sizeBytes: 123456,
    });

    // Pause before tar, unpause after — and read the container's health
    // again after the unpause, which Docker leaves `unhealthy` until the
    // next probe.
    const dockerCalls = dockerMock.mock.calls.map((c) => c[0]);
    expect(dockerCalls).toContain('pause');
    expect(dockerCalls).toContain('unpause');
    expect(dockerCalls.indexOf('pause')).toBeLessThan(
      dockerCalls.indexOf('unpause'),
    );
    expect(dockerCalls.lastIndexOf('container')).toBeGreaterThan(
      dockerCalls.indexOf('unpause'),
    );

    // Manifest write is the LAST exec call and carries the JSON via stdin.
    const lastExec = execMock.mock.calls[execMock.mock.calls.length - 1];
    const lastScript = lastExec[1][lastExec[1].length - 1];
    expect(lastScript).toContain('manifest.json');
    expect(lastExec[2]?.stdin).toContain('"trigger":"manual"');
  });

  test('unpauses even when the tar fails, and writes no manifest', async () => {
    volumeExistsMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'p_db-data'),
    );
    ensureVolumesMock.mockResolvedValue(true);
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] === 'ps') return Promise.resolve(ok('abc123\n'));
      if (args[0] === 'container') return Promise.resolve(ok(HEALTHY_DB));
      return Promise.resolve(ok());
    });
    execMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'disk full',
      exitCode: 1,
    });

    await expect(
      createSnapshot({
        prefix: 'p_',
        trigger: 'deploy',
        platformVersion: null,
      }),
    ).rejects.toThrow('Snapshot of volume p_db-data failed');

    const dockerCalls = dockerMock.mock.calls.map((c) => c[0]);
    expect(dockerCalls).toContain('unpause');
    // Only the failed tar ran — no manifest write.
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  // Every pause costs a container a fresh health probe before it reports
  // healthy again; the proxy owns two volumes and is paused once for both.
  test('pauses containers that share volumes once, around all of their archives', async () => {
    volumeExistsMock.mockImplementation((name: string) =>
      Promise.resolve(
        ['p_db-data', 'p_caddy-data', 'p_caddy-config'].includes(name),
      ),
    );
    ensureVolumesMock.mockResolvedValue(true);
    const events: string[] = [];
    dockerMock.mockImplementation((...args: string[]) => {
      const target = args[args.length - 1];
      if (args[0] === 'ps') {
        return Promise.resolve(
          ok(target === 'volume=p_db-data' ? 'db1\n' : 'proxy1\n'),
        );
      }
      if (args[0] === 'container') return Promise.resolve(ok(HEALTHY_DB));
      if (args[0] === 'pause' || args[0] === 'unpause') {
        events.push(`${args[0]} ${target}`);
      }
      return Promise.resolve(ok());
    });
    execMock.mockImplementation((_cmd: string, args: string[]) => {
      const tar = /tar czf \/backup\/[^/]+\/([a-z-]+)\.tar\.gz/.exec(
        args[args.length - 1],
      );
      if (!tar) return Promise.resolve(ok());
      events.push(`tar ${tar[1]}`);
      return Promise.resolve(ok(`${SHA}  ${tar[1]}.tar.gz\n4096`));
    });

    const manifest = await createSnapshot({
      prefix: 'p_',
      trigger: 'manual',
      platformVersion: null,
    });

    expect(events).toEqual([
      'pause db1',
      'tar db-data',
      'unpause db1',
      'pause proxy1',
      'tar caddy-data',
      'tar caddy-config',
      'unpause proxy1',
    ]);
    expect(Object.keys(manifest?.volumes ?? {})).toEqual([
      'db-data',
      'caddy-data',
      'caddy-config',
    ]);
  });

  test('snapshots convex-data when that is still the live config store', async () => {
    volumeExistsMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'p_convex-data' || name === 'p_db-data'),
    );
    ensureVolumesMock.mockResolvedValue(true);
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] === 'ps') return Promise.resolve(ok(''));
      return Promise.resolve(ok());
    });
    execMock.mockImplementation((_cmd: string, args: string[]) => {
      const script = args[args.length - 1];
      if (script.includes('object-storage/connection.json')) {
        return Promise.resolve(ok(''));
      }
      const tar = /tar czf \/backup\/[^/]+\/([a-z-]+)\.tar\.gz/.exec(script);
      if (tar) {
        return Promise.resolve(ok(`${SHA}  ${tar[1]}.tar.gz\n4096`));
      }
      return Promise.resolve(ok());
    });

    const manifest = await createSnapshot({
      prefix: 'p_',
      trigger: 'deploy',
      platformVersion: '0.5.10',
    });

    expect(Object.keys(manifest?.volumes ?? {}).sort()).toEqual([
      'convex-data',
      'db-data',
    ]);
    expect(tarredVolumes()).toContain('convex-data');
    expect(tarredVolumes()).not.toContain('config-data');
  });

  test('throws when no data volumes exist', async () => {
    volumeExistsMock.mockResolvedValue(false);

    await expect(
      createSnapshot({
        prefix: 'p_',
        trigger: 'deploy',
        platformVersion: null,
      }),
    ).rejects.toThrow('nothing to snapshot');
    expect(execMock).not.toHaveBeenCalled();
  });

  test('returns null instead of throwing with allowMissingVolumes', async () => {
    volumeExistsMock.mockResolvedValue(false);

    const manifest = await createSnapshot({
      prefix: 'p_',
      trigger: 'start',
      platformVersion: null,
      allowMissingVolumes: true,
    });
    expect(manifest).toBeNull();
    expect(execMock).not.toHaveBeenCalled();
  });

  test('rejects unparseable integrity output instead of recording it', async () => {
    volumeExistsMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'p_db-data'),
    );
    ensureVolumesMock.mockResolvedValue(true);
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] === 'ps') return Promise.resolve(ok(''));
      return Promise.resolve(ok());
    });
    execMock.mockResolvedValue(ok('garbage output'));

    await expect(
      createSnapshot({
        prefix: 'p_',
        trigger: 'deploy',
        platformVersion: null,
      }),
    ).rejects.toThrow('unparseable integrity output');
  });

  // The model relay in the backend replaced the sandbox LLM gateway
  // (tale-project/tale#4942). A deployment that ran it keeps its volume until
  // its operator removes it, and no snapshot takes it any more; one taken
  // while the gateway ran still restores it.
  describe('the retired model gateway store', () => {
    /**
     * The gateway volume an earlier release left and one other, each used by
     * its own container, with every pause, unpause and archive recorded in
     * order.
     */
    function seedGatewayStack() {
      volumeExistsMock.mockImplementation((name: string) =>
        Promise.resolve(['p_db-data', 'p_llm-gateway-data'].includes(name)),
      );
      ensureVolumesMock.mockResolvedValue(true);
      const events: string[] = [];
      dockerMock.mockImplementation((...args: string[]) => {
        const target = args[args.length - 1];
        if (args[0] === 'ps') {
          return Promise.resolve(
            ok(target === 'volume=p_llm-gateway-data' ? 'gw1\n' : 'db1\n'),
          );
        }
        if (args[0] === 'container') return Promise.resolve(ok(HEALTHY_DB));
        if (args[0] === 'pause' || args[0] === 'unpause') {
          events.push(`${args[0]} ${target}`);
        }
        return Promise.resolve(ok());
      });
      execMock.mockImplementation((_cmd: string, args: string[]) => {
        const script = args[args.length - 1];
        if (script.includes('manifest.json')) events.push('manifest');
        const tar = /tar czf \/backup\/[^/]+\/([a-z-]+)\.tar\.gz/.exec(script);
        if (!tar) return Promise.resolve(ok());
        events.push(`tar ${tar[1]}`);
        return Promise.resolve(ok(`${SHA}  ${tar[1]}.tar.gz\n4096`));
      });
      return events;
    }

    test('is not taken where a deployment keeps it, and its gateway is never paused', async () => {
      const events = seedGatewayStack();

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'deploy',
        platformVersion: '0.5.64',
      });

      expect(events).toEqual([
        'pause db1',
        'tar db-data',
        'unpause db1',
        'manifest',
      ]);
      expect(Object.keys(manifest?.volumes ?? {})).toEqual(['db-data']);
      expect(
        dockerMock.mock.calls.some((call) =>
          call.some((arg) => String(arg).includes('llm-gateway-data')),
        ),
      ).toBe(false);
    });

    test('an archive of it in an older snapshot is still one a restore accepts, into its own volume', async () => {
      const { RESTORABLE_ARCHIVES, restoreTargetVolume, SNAPSHOT_VOLUMES } =
        await import('./constants');
      expect(SNAPSHOT_VOLUMES).not.toContain('llm-gateway-data');
      expect(RESTORABLE_ARCHIVES).toContain('llm-gateway-data');
      expect(restoreTargetVolume('llm-gateway-data')).toBe('llm-gateway-data');
    });
  });

  describe('the blob volume', () => {
    test('is captured with the other data volumes when the deployment default is the bundled store', async () => {
      seedLocalStack([connectionRow('default', BUNDLED_CONNECTION)]);

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'manual',
        platformVersion: '0.5.7',
      });

      expect(Object.keys(manifest?.volumes ?? {}).sort()).toEqual([
        'blob-data',
        'caddy-config',
        'caddy-data',
        'config-data',
        'db-data',
        'knowledge-db-data',
        'proxy-data',
      ]);
      expect(manifest?.volumes['blob-data']).toEqual({
        sha256: SHA,
        sizeBytes: 4096,
      });
      expect(tarredVolumes()).toContain('blob-data');
      // The config store is read read-only, from the SAME volume the backend
      // resolves connection files from.
      const inspection = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes(
          'object-storage/connection.json',
        ),
      );
      expect(inspection?.[1]).toContain('p_config-data:/data:ro');
      // Blobs are proportional to the store: the tar gets the wider bound.
      const blobTar = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes('blob-data.tar.gz'),
      );
      expect(blobTar?.[2]?.timeout).toBeGreaterThan(1800);
      expect(loggerNoticeMock).not.toHaveBeenCalled();
    });

    test('is left out, with a one-line notice, when the deployment default is external S3', async () => {
      seedLocalStack([connectionRow('default', EXTERNAL_CONNECTION)]);

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'deploy',
        platformVersion: '0.5.7',
      });

      expect(manifest?.volumes['blob-data']).toBeUndefined();
      expect(tarredVolumes()).not.toContain('blob-data');
      expect(Object.keys(manifest?.volumes ?? {})).toHaveLength(6);
      const notices = loggerNoticeMock.mock.calls.map((call) =>
        String(call[0]),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('https://s3.eu-central-1.amazonaws.com');
      expect(notices[0]).toContain('acme-tale-blobs');
      expect(notices[0]).toContain('not in this snapshot');
    });

    test('is still captured when organizations bring their own bucket, and those orgs are named', async () => {
      seedLocalStack([
        connectionRow('default', BUNDLED_CONNECTION),
        connectionRow('acme', EXTERNAL_CONNECTION),
        connectionRow('globex', { ...EXTERNAL_CONNECTION, bucket: 'globex' }),
      ]);

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'manual',
        platformVersion: '0.5.7',
      });

      expect(manifest?.volumes['blob-data']).toBeDefined();
      const notices = loggerNoticeMock.mock.calls.map((call) =>
        String(call[0]),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('2 organization(s)');
      expect(notices[0]).toContain('acme, globex');
      expect(notices[0]).toContain('not in this snapshot');
    });

    test('is captured (fail-safe) when the config store cannot be inspected', async () => {
      seedLocalStack([]);
      execMock.mockImplementation((_cmd: string, args: string[]) => {
        const script = args[args.length - 1];
        if (script.includes('object-storage/connection.json')) {
          return Promise.resolve(failed('permission denied'));
        }
        const tar = /tar czf \/backup\/[^/]+\/([a-z-]+)\.tar\.gz/.exec(script);
        if (tar) {
          return Promise.resolve(ok(`${SHA}  ${tar[1]}.tar.gz\n4096`));
        }
        return Promise.resolve(ok());
      });

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'manual',
        platformVersion: null,
      });

      expect(manifest?.volumes['blob-data']).toBeDefined();
      const warnings = loggerWarnMock.mock.calls.map((call) => String(call[0]));
      expect(warnings.some((line) => line.includes('permission denied'))).toBe(
        true,
      );
    });

    test('is captured (fail-safe) when the default connection file is unreadable', async () => {
      seedLocalStack([
        '/data/default/object-storage/connection.json\t{not json',
      ]);

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'manual',
        platformVersion: null,
      });

      expect(manifest?.volumes['blob-data']).toBeDefined();
      expect(loggerWarnMock).toHaveBeenCalled();
    });

    test('is captured when no connection file exists yet (store never seeded)', async () => {
      seedLocalStack([]);

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'manual',
        platformVersion: null,
      });

      expect(manifest?.volumes['blob-data']).toBeDefined();
      expect(loggerNoticeMock).not.toHaveBeenCalled();
    });

    // versitygw keeps what S3 says of an object (its content type, its ETag)
    // in the file's extended attributes: busybox's tar leaves them behind, so
    // an archive of it would restore every object without them.
    test('is archived with its extended attributes, by a tar that keeps them', async () => {
      seedLocalStack([connectionRow('default', BUNDLED_CONNECTION)]);

      await createSnapshot({
        prefix: 'p_',
        trigger: 'manual',
        platformVersion: '0.6.0',
      });

      const tarOf = (volume: string) =>
        execMock.mock.calls.find((call) =>
          String(call[1][call[1].length - 1]).includes(`${volume}.tar.gz `),
        )?.[1] as string[] | undefined;
      const blob = tarOf('blob-data');
      expect(blob?.at(-1)).toContain('tar czf /backup/');
      expect(blob?.at(-1)).toContain(
        "blob-data.tar.gz --xattrs --xattrs-include='user.*' -C /data .",
      );
      expect(blob).toContain(
        'debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587',
      );
      // Every other volume as before: no attribute of theirs is data.
      const db = tarOf('db-data');
      expect(db?.at(-1)).toContain('db-data.tar.gz -C /data .');
      expect(db?.at(-1)).not.toContain('--xattrs');
      expect(db).toContain('alpine:3.22');
    });

    /** A deployment whose blobs are still in MinIO's volume: the probe of
     * `object-store-data` finds content, the one of `blob-data` none. */
    function seedStackOnMinio() {
      seedLocalStack([connectionRow('default', BUNDLED_CONNECTION)]);
      const seeded = execMock.getMockImplementation();
      execMock.mockImplementation((cmd: string, args: string[]) => {
        const script = args[args.length - 1];
        if (script.includes('-print -quit')) {
          return Promise.resolve(
            ok(
              args.includes('p_object-store-data:/data:ro')
                ? '/data/.minio.sys'
                : '',
            ),
          );
        }
        return seeded?.(cmd, args);
      });
    }

    test("is MinIO's volume on a deployment that still runs MinIO, archived as it always was", async () => {
      seedStackOnMinio();

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'deploy',
        platformVersion: '0.5.9',
      });

      // `blob-data` exists there too (every volume of the stack is created
      // on every run) and holds nothing: it is not what the blobs are in.
      expect(manifest?.volumes['object-store-data']).toEqual({
        sha256: SHA,
        sizeBytes: 4096,
      });
      expect(manifest?.volumes['blob-data']).toBeUndefined();
      expect(tarredVolumes()).not.toContain('blob-data');
      const tar = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes(
          'object-store-data.tar.gz ',
        ),
      );
      expect(tar?.[1]).toContain('alpine:3.22');
      expect(String(tar?.[1].at(-1))).not.toContain('--xattrs');
      expect(tar?.[2]?.timeout).toBeGreaterThan(1800);
    });

    test("is versitygw's volume once it holds blobs, and MinIO's is archived no more", async () => {
      seedLocalStack([connectionRow('default', BUNDLED_CONNECTION)]);
      const seeded = execMock.getMockImplementation();
      // A deployment that was moved: both volumes hold something.
      execMock.mockImplementation((cmd: string, args: string[]) =>
        String(args[args.length - 1]).includes('-print -quit')
          ? Promise.resolve(ok('/data/tale-blobs'))
          : seeded?.(cmd, args),
      );

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'deploy',
        platformVersion: '0.6.0',
      });

      expect(manifest?.volumes['blob-data']).toBeDefined();
      expect(manifest?.volumes['object-store-data']).toBeUndefined();
      expect(tarredVolumes()).not.toContain('object-store-data');
    });

    test('fails rather than guess when the blob volumes cannot be looked into', async () => {
      seedLocalStack([connectionRow('default', BUNDLED_CONNECTION)]);
      const seeded = execMock.getMockImplementation();
      execMock.mockImplementation((cmd: string, args: string[]) =>
        String(args[args.length - 1]).includes('-print -quit')
          ? Promise.resolve(failed('cannot connect to the Docker daemon'))
          : seeded?.(cmd, args),
      );

      await expect(
        createSnapshot({
          prefix: 'p_',
          trigger: 'deploy',
          platformVersion: '0.6.0',
        }),
      ).rejects.toThrow(
        /Could not inspect p_blob-data for existing blobs: cannot connect to the Docker daemon/,
      );
      // Nothing was archived: a snapshot without the blobs would read as one
      // with them.
      expect(tarredVolumes()).toEqual([]);
    });
  });
});

describePosix('createSnapshot on Incus (design D-28)', () => {
  let fixture: IncusBackupFixture;
  beforeEach(() => {
    fixture = incusBackupFixture();
  });
  afterEach(() => {
    fixture.remove();
  });

  test('takes one native set of the data volumes under one freeze, and writes manifest v2 by generation', async () => {
    const manifest = await createSnapshot({
      prefix: '',
      trigger: 'deploy',
      platformVersion: '0.5.9',
      runtime: fixture.runtime,
    });
    expect(manifest?.schemaVersion).toBe(2);
    expect(manifest?.runtime).toBe('incus');
    expect(Object.keys(manifest?.volumes ?? {}).sort()).toEqual([
      'config-data',
      'db-data',
    ]);
    for (const info of Object.values(manifest?.volumes ?? {})) {
      expect(info.native?.snapshot).toBe(`tale-${manifest?.id}`);
      expect(info.sha256).toBeUndefined();
    }
    // The CLI-owned volumes are never in a set (R-07), whatever exists.
    expect(
      fixture.fake.seen(
        'POST /1.0/storage-pools/tale/volumes/custom/sandbox-credentials/snapshots',
      ),
    ).toEqual([]);
    expect(
      fixture.text('backups', `/${manifest?.id}/manifest.1.json`),
    ).toContain('"schemaVersion":2');
    // No tar ran: the set is native only.
    expect(
      fixture.helperCommands.some((line) => line.includes('tar czf')),
    ).toBe(false);
    const freezes = fixture.fake
      .seen('PUT /1.0/instances/*/state')
      .filter(
        (request) => (request.body as { action?: string }).action === 'freeze',
      );
    expect(freezes).toHaveLength(2);
  });

  test("--archive writes today's tar.gz of each volume from a copy of its snapshot", async () => {
    const manifest = await createSnapshot({
      prefix: '',
      trigger: 'manual',
      platformVersion: null,
      runtime: fixture.runtime,
      archive: true,
    });
    const tars = fixture.helperCommands.filter((line) =>
      line.includes('tar czf'),
    );
    expect(tars).toHaveLength(2);
    for (const line of tars) expect(line).toContain('--numeric-owner');
    expect(manifest?.volumes['db-data']?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest?.volumes['db-data']?.native).toBeDefined();
    // The newest generation records the archives; the first is gone.
    expect(
      fixture.text('backups', `/${manifest?.id}/manifest.1.json`),
    ).toBeUndefined();
    expect(
      fixture.text('backups', `/${manifest?.id}/manifest.2.json`),
    ).toContain('sha256');
  });

  test('refuses without a backups volume to hold the manifest', async () => {
    await fixture.runtime.removeVolume('backups');
    await expect(
      createSnapshot({
        prefix: '',
        trigger: 'manual',
        platformVersion: null,
        runtime: fixture.runtime,
      }),
    ).rejects.toThrow(/no backups volume/);
  });
});
