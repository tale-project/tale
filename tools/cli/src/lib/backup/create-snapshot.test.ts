import { afterEach, describe, expect, mock, test } from 'bun:test';

import { createSnapshot } from './create-snapshot';

const dockerMock = mock();
const execMock = mock();
const ensureVolumesMock = mock();
const volumeExistsMock = mock();
const loggerWarnMock = mock();
const loggerNoticeMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/exec', () => ({ exec: execMock }));
mock.module('../docker/ensure-volumes', () => ({
  ensureVolumes: ensureVolumesMock,
  volumeExists: volumeExistsMock,
}));
mock.module('../../utils/logger', () => ({
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
  test('pauses volume users, tars, unpauses, and writes the manifest last', async () => {
    // Only db-data exists under the prefix.
    volumeExistsMock.mockImplementation((name: string) =>
      Promise.resolve(name === 'p_db-data'),
    );
    ensureVolumesMock.mockResolvedValue(true);
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] === 'ps') return Promise.resolve(ok('abc123\n'));
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

    // Pause before tar, unpause after.
    const dockerCalls = dockerMock.mock.calls.map((c) => c[0]);
    expect(dockerCalls).toContain('pause');
    expect(dockerCalls).toContain('unpause');
    expect(dockerCalls.indexOf('pause')).toBeLessThan(
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

  describe('the blob volume', () => {
    test('is captured with the other data volumes when the deployment default is the bundled store', async () => {
      seedLocalStack([connectionRow('default', BUNDLED_CONNECTION)]);

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'manual',
        platformVersion: '0.5.7',
      });

      expect(Object.keys(manifest?.volumes ?? {}).sort()).toEqual([
        'caddy-config',
        'caddy-data',
        'convex-data',
        'db-data',
        'object-store-data',
      ]);
      expect(manifest?.volumes['object-store-data']).toEqual({
        sha256: SHA,
        sizeBytes: 4096,
      });
      expect(tarredVolumes()).toContain('object-store-data');
      // The config store is read read-only, from the SAME volume the backend
      // resolves connection files from.
      const inspection = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes(
          'object-storage/connection.json',
        ),
      );
      expect(inspection?.[1]).toContain('p_convex-data:/data:ro');
      // Blobs are proportional to the store: the tar gets the wider bound.
      const blobTar = execMock.mock.calls.find((call) =>
        String(call[1][call[1].length - 1]).includes(
          'object-store-data.tar.gz',
        ),
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

      expect(manifest?.volumes['object-store-data']).toBeUndefined();
      expect(tarredVolumes()).not.toContain('object-store-data');
      expect(Object.keys(manifest?.volumes ?? {})).toHaveLength(4);
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

      expect(manifest?.volumes['object-store-data']).toBeDefined();
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

      expect(manifest?.volumes['object-store-data']).toBeDefined();
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

      expect(manifest?.volumes['object-store-data']).toBeDefined();
      expect(loggerWarnMock).toHaveBeenCalled();
    });

    test('is captured when no connection file exists yet (store never seeded)', async () => {
      seedLocalStack([]);

      const manifest = await createSnapshot({
        prefix: 'p_',
        trigger: 'manual',
        platformVersion: null,
      });

      expect(manifest?.volumes['object-store-data']).toBeDefined();
      expect(loggerNoticeMock).not.toHaveBeenCalled();
    });
  });
});
