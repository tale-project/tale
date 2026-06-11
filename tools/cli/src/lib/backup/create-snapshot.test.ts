import { afterEach, describe, expect, mock, test } from 'bun:test';

import { createSnapshot } from './create-snapshot';

const dockerMock = mock();
const execMock = mock();
const ensureVolumesMock = mock();
const volumeExistsMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/exec', () => ({ exec: execMock }));
mock.module('../docker/ensure-volumes', () => ({
  ensureVolumes: ensureVolumesMock,
  volumeExists: volumeExistsMock,
}));
mock.module('../../utils/logger', () => ({
  info: mock(),
  error: mock(),
  warn: mock(),
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
  notice: mock(),
  table: mock(),
}));

const SHA = 'a'.repeat(64);

function ok(stdout = '') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

afterEach(() => {
  dockerMock.mockReset();
  execMock.mockReset();
  ensureVolumesMock.mockReset();
  volumeExistsMock.mockReset();
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
});
