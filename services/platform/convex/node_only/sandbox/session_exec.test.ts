// runStepsInSession's install semantics — pip/npm exit codes must fail the
// run (INSTALL_FAILED) and installs get their own floored budget — plus the
// harvest's per-file skip semantics. The session wire is mocked at the
// session_client boundary, the same seam the crawler render tests use.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';

const drainSessionExecResilient = vi.fn();
const sessionListFiles = vi.fn();
const sessionReadFile = vi.fn();

vi.mock('./helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) =>
    drainSessionExecResilient(...args),
  sessionListFiles: (...args: unknown[]) => sessionListFiles(...args),
  sessionReadFile: (...args: unknown[]) => sessionReadFile(...args),
}));

const putBlob = vi.fn();
const deleteBlob = vi.fn();

vi.mock('../../lib/storage/blob_access', () => ({
  putBlob: (...args: unknown[]) => putBlob(...args),
  deleteBlob: (...args: unknown[]) => deleteBlob(...args),
}));

const orgSlugFromIdOrNull = vi.fn();

vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: (...args: unknown[]) => orgSlugFromIdOrNull(...args),
}));

import { harvestSessionOutput, runStepsInSession } from './session_exec';

function execResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    status: 'completed',
    exitCode: 0,
    durationMs: 5,
    stdoutBase64: Buffer.from('').toString('base64'),
    stderrBase64: Buffer.from('').toString('base64'),
    truncated: { stdout: false, stderr: false },
    ...over,
  };
}

function callArg(call: number): {
  command: string[];
  timeoutMs: number;
  cwd: string;
} {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper over the mocked wire body
  return drainSessionExecResilient.mock.calls[call][1] as {
    command: string[];
    timeoutMs: number;
    cwd: string;
  };
}

describe('runStepsInSession — install semantics', () => {
  beforeEach(() => {
    drainSessionExecResilient.mockReset();
  });

  it('runs a packages-only call to completed and surfaces installer stdout', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({
        stdoutBase64: Buffer.from(
          'Successfully installed pandas-2.2.1\n',
        ).toString('base64'),
      }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: [],
      packagesByLang: { python: ['pandas'] },
    });
    expect(run.status).toBe('completed');
    expect(run.exitCode).toBe(0);
    expect(run.errorCode).toBeUndefined();
    expect(run.stdout).toContain('Successfully installed pandas-2.2.1');
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(1);
    expect(callArg(0).command).toEqual([
      'python3',
      '-m',
      'pip',
      'install',
      '--no-input',
      'pandas',
    ]);
    // Installs run from the workspace root — /user/code may not exist yet on
    // a fresh session with nothing staged, and runnerd rejects a missing cwd.
    expect(callArg(0).cwd).toBe('/user');
  });

  it('fails the run when pip exits non-zero: INSTALL_FAILED, nothing else runs', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({
        exitCode: 1,
        stderrBase64: Buffer.from(
          'ERROR: No matching distribution found for nope\n',
        ).toString('base64'),
      }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: ['/user/code/a.py'],
      packagesByLang: { python: ['nope'], node: ['sharp'] },
    });
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('INSTALL_FAILED');
    expect(run.errorMessage).toContain('pip install failed (exit 1)');
    expect(run.stderr).toContain('No matching distribution');
    // Short-circuit: neither the npm install nor the step ran.
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(1);
  });

  it('fails on npm after a clean pip and names the failing tool', async () => {
    drainSessionExecResilient
      .mockResolvedValueOnce(execResult())
      .mockResolvedValueOnce(execResult({ exitCode: 127 }));
    const run = await runStepsInSession('sid', {
      stepPaths: [],
      packagesByLang: { python: ['pandas'], node: ['sharp'] },
    });
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('INSTALL_FAILED');
    expect(run.errorMessage).toContain('npm install failed (exit 127)');
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(2);
  });

  it('treats a non-completed install status as INSTALL_FAILED even with exit 0', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({ status: 'failed', errorCode: 'TIMEOUT' }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: [],
      packagesByLang: { python: ['torch'] },
    });
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('INSTALL_FAILED');
    expect(run.errorMessage).toContain('TIMEOUT');
  });

  it('floors the install budget at 120s while the step keeps its own timeout', async () => {
    drainSessionExecResilient.mockResolvedValue(execResult());
    await runStepsInSession('sid', {
      stepPaths: ['/user/code/a.py'],
      packagesByLang: { python: ['pandas'] },
      timeoutMs: 30_000,
    });
    expect(callArg(0).timeoutMs).toBe(120_000);
    expect(callArg(1).timeoutMs).toBe(30_000);
    expect(callArg(1).command).toEqual(['python3', '/user/code/a.py']);
    expect(callArg(0).cwd).toBe('/user');
    expect(callArg(1).cwd).toBe('/user/code');
  });

  it('keeps a caller-raised timeout for the install too, capped at 300s', async () => {
    drainSessionExecResilient.mockResolvedValue(execResult());
    await runStepsInSession('sid', {
      stepPaths: [],
      packagesByLang: { python: ['torch'] },
      timeoutMs: 240_000,
    });
    expect(callArg(0).timeoutMs).toBe(240_000);
  });

  it('does not add install execs for package-less callers (workflow/crawler path)', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({
        stdoutBase64: Buffer.from('hello\n').toString('base64'),
      }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: ['/user/code/a.py'],
      timeoutMs: 45_000,
    });
    expect(run.status).toBe('completed');
    expect(run.stdout).toBe('hello\n');
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(1);
    expect(callArg(0).command).toEqual(['python3', '/user/code/a.py']);
    expect(callArg(0).timeoutMs).toBe(45_000);
  });

  it('keeps install noise out of a successful script run stdout', async () => {
    drainSessionExecResilient
      .mockResolvedValueOnce(
        execResult({
          stdoutBase64: Buffer.from(
            'Collecting pandas\nSuccessfully installed pandas-2.2.1\n',
          ).toString('base64'),
        }),
      )
      .mockResolvedValueOnce(
        execResult({
          stdoutBase64: Buffer.from('report written\n').toString('base64'),
        }),
      );
    const run = await runStepsInSession('sid', {
      stepPaths: ['/user/code/a.py'],
      packagesByLang: { python: ['pandas'] },
    });
    expect(run.stdout).toBe('report written\n');
  });
});

const ORG = 'org-1';

function harvestCtx(over: {
  runQuery?: ReturnType<typeof vi.fn>;
  runMutation?: ReturnType<typeof vi.fn>;
  store?: ReturnType<typeof vi.fn>;
  storageDelete?: ReturnType<typeof vi.fn>;
}) {
  const ctx = {
    runQuery: over.runQuery ?? vi.fn().mockResolvedValue(null),
    runMutation:
      over.runMutation ??
      vi.fn().mockResolvedValue({ id: 'row', replaced: false }),
    storage: {
      store: over.store ?? vi.fn().mockResolvedValue('kg-stored'),
      delete: over.storageDelete ?? vi.fn(),
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- harvest touches only these ctx members
  return ctx as unknown as ActionCtx;
}

function outputEntry(name: string, size = 5) {
  return { name, type: 'file' as const, size, mtimeMs: 0 };
}

function textBytes(s: string): { bytes: ArrayBuffer; contentType: string } {
  const encoded = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return { bytes: buf, contentType: 'text/plain' };
}

describe('harvestSessionOutput — per-file harvest skips', () => {
  beforeEach(() => {
    sessionListFiles.mockReset();
    sessionReadFile.mockReset();
    orgSlugFromIdOrNull.mockReset();
    orgSlugFromIdOrNull.mockResolvedValue(null);
  });

  const harvestArgs = { organizationId: ORG, sessionId: 'sid' };

  it('skips an over-cap output without reading it and keeps the harvest green', async () => {
    sessionListFiles.mockResolvedValue([
      outputEntry('big.bin', 25 * 1024 * 1024),
      outputEntry('ok.txt'),
    ]);
    sessionReadFile.mockResolvedValue(textBytes('hello'));
    const ctx = harvestCtx({});
    const { files, harvestSkipped } = await harvestSessionOutput(
      ctx,
      harvestArgs,
    );
    expect(files.map((f) => f.path)).toEqual(['/user/output/ok.txt']);
    expect(harvestSkipped).toHaveLength(1);
    expect(harvestSkipped[0]?.path).toBe('/user/output/big.bin');
    expect(harvestSkipped[0]?.reason).toContain('20.0 MB');
    // The oversize file was never pulled across the wire.
    expect(sessionReadFile).toHaveBeenCalledTimes(1);
  });

  it('turns a store rejection into a skip, not a harvest failure', async () => {
    // One file's storage failure records a skip and never fails the harvest
    // or the sibling file.
    sessionListFiles.mockResolvedValue([
      outputEntry('a.txt'),
      outputEntry('b.txt'),
    ]);
    sessionReadFile
      .mockResolvedValueOnce(textBytes('content-a'))
      .mockResolvedValueOnce(textBytes('content-b'));
    const store = vi
      .fn()
      .mockRejectedValueOnce(new Error('Workspace would exceed the byte cap.'))
      .mockResolvedValueOnce('kg-b');
    const storageDelete = vi.fn();
    const ctx = harvestCtx({ store, storageDelete });
    const { files, harvestSkipped } = await harvestSessionOutput(
      ctx,
      harvestArgs,
    );
    expect(files.map((f) => f.path)).toEqual(['/user/output/b.txt']);
    expect(harvestSkipped).toHaveLength(1);
    expect(harvestSkipped[0]?.path).toBe('/user/output/a.txt');
    expect(harvestSkipped[0]?.reason).toContain('not saved to the workspace');
    // Nothing to reap: the rejected store never produced a blob, and b.txt's
    // blob stays.
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it('reports files beyond the per-run cap and unreadable files', async () => {
    const many = Array.from({ length: 18 }, (_, i) => outputEntry(`f${i}.txt`));
    sessionListFiles.mockResolvedValue(many);
    sessionReadFile.mockImplementation(async (_sid: string, path: string) =>
      path === '/user/output/f3.txt' ? null : textBytes('x'),
    );
    const ctx = harvestCtx({});
    const { files, harvestSkipped } = await harvestSessionOutput(
      ctx,
      harvestArgs,
    );
    // The 16-slot cap counts HARVESTED files: f3's read failure frees a slot,
    // so 16 of the remaining 17 land and the last (f17) reports the cap.
    expect(files).toHaveLength(16);
    expect(harvestSkipped).toHaveLength(2);
    expect(
      harvestSkipped.find((s) => s.path === '/user/output/f3.txt')?.reason,
    ).toContain('read from sandbox failed');
    expect(
      harvestSkipped.find((s) => s.path === '/user/output/f17.txt')?.reason,
    ).toContain('per-run harvest cap');
  });
});
