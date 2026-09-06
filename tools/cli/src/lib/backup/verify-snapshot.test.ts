import { afterEach, describe, expect, mock, test } from 'bun:test';

import { verifySnapshot } from './verify-snapshot';

const execMock = mock();

mock.module('../docker/exec', () => ({ exec: execMock }));

afterEach(() => {
  execMock.mockReset();
});

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const MANIFEST = {
  id: '20260903-090000-manual',
  volumes: {
    'db-data': { sha256: SHA_A, sizeBytes: 10 },
    'object-store-data': { sha256: SHA_B, sizeBytes: 20 },
  },
};

describe('verifySnapshot', () => {
  test('checks every manifest-listed archive against its recorded hash, read-only', async () => {
    execMock.mockResolvedValue({
      success: true,
      stdout: ['db-data.tar.gz: OK', 'object-store-data.tar.gz: OK'].join('\n'),
      stderr: '',
      exitCode: 0,
    });

    await verifySnapshot('p_', MANIFEST);

    expect(execMock).toHaveBeenCalledTimes(1);
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain('p_backups:/backup:ro');
    const script = args[args.length - 1];
    expect(script).toContain('cd /backup/20260903-090000-manual');
    // The manifest is the contract: a listed archive that is absent fails
    // BEFORE restore wipes the live volume, instead of passing because the
    // sidecars that happen to exist all check out.
    expect(script).toContain('test -f db-data.tar.gz ||');
    expect(script).toContain(
      `echo "${SHA_A}  db-data.tar.gz" | sha256sum -c -`,
    );
    expect(script).toContain('test -f object-store-data.tar.gz ||');
    expect(script).toContain(
      `echo "${SHA_B}  object-store-data.tar.gz" | sha256sum -c -`,
    );
  });

  test('throws on the first mismatch or missing archive', async () => {
    execMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'object-store-data.tar.gz: MISSING',
      exitCode: 1,
    });

    await expect(verifySnapshot('p_', MANIFEST)).rejects.toThrow(
      'failed integrity verification: object-store-data.tar.gz: MISSING',
    );
  });

  test('never interpolates a volume the CLI does not snapshot, or a malformed hash', async () => {
    execMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });
    await verifySnapshot('p_', {
      id: MANIFEST.id,
      volumes: {
        'db-data': { sha256: SHA_A, sizeBytes: 1 },
        '../etc': { sha256: SHA_A, sizeBytes: 1 },
      },
    });
    const script = (execMock.mock.calls[0][1] as string[]).at(-1);
    expect(script).not.toContain('../etc');

    await expect(
      verifySnapshot('p_', {
        id: MANIFEST.id,
        volumes: { 'db-data': { sha256: '$(reboot)', sizeBytes: 1 } },
      }),
    ).rejects.toThrow('malformed sha256');
  });

  test('rejects an id with shell metacharacters before running anything', async () => {
    await expect(
      verifySnapshot('p_', { id: '$(rm -rf /backup)', volumes: {} }),
    ).rejects.toThrow('Invalid snapshot id');
    expect(execMock).not.toHaveBeenCalled();
  });
});
