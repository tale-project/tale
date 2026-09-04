import { afterEach, describe, expect, mock, test } from 'bun:test';

import { verifySnapshot } from './verify-snapshot';

const execMock = mock();

mock.module('../docker/exec', () => ({ exec: execMock }));

afterEach(() => {
  execMock.mockReset();
});

describe('verifySnapshot', () => {
  test('checks every archive sidecar in the snapshot directory, read-only', async () => {
    execMock.mockResolvedValue({
      success: true,
      // One line per sidecar — the blob archive is verified like the rest.
      stdout: [
        'db-data.tar.gz: OK',
        'convex-data.tar.gz: OK',
        'object-store-data.tar.gz: OK',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    });

    await verifySnapshot('p_', '20260903-090000-manual');

    expect(execMock).toHaveBeenCalledTimes(1);
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain('p_backups:/backup:ro');
    const script = args[args.length - 1];
    expect(script).toContain('cd /backup/20260903-090000-manual');
    // The glob covers every volume archive, not a fixed list.
    expect(script).toContain('sha256sum -c *.tar.gz.sha256');
  });

  test('throws on the first mismatch', async () => {
    execMock.mockResolvedValue({
      success: false,
      stdout: 'object-store-data.tar.gz: FAILED',
      stderr: '',
      exitCode: 1,
    });

    await expect(
      verifySnapshot('p_', '20260903-090000-manual'),
    ).rejects.toThrow('failed integrity verification: object-store-data');
  });

  test('rejects an id with shell metacharacters before running anything', async () => {
    await expect(verifySnapshot('p_', '$(rm -rf /backup)')).rejects.toThrow(
      'Invalid snapshot id',
    );
    expect(execMock).not.toHaveBeenCalled();
  });
});
