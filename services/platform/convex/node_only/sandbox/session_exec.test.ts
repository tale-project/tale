// Inline-snippet staging contract (pure functions), the executeCodeInSession
// arg mutex, and runStepsInSession's install semantics — pip/npm exit codes
// must fail the run (INSTALL_FAILED) and installs get their own floored
// budget. The session wire is mocked at the session_client boundary, the same
// seam the crawler render tests use.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const drainSessionExecResilient = vi.fn();

vi.mock('./helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) =>
    drainSessionExecResilient(...args),
  sessionDeleteFiles: vi.fn(),
  sessionListFiles: vi.fn().mockResolvedValue([]),
  sessionReadFile: vi.fn(),
  sessionStageFiles: vi.fn(),
}));

import {
  execInputsError,
  inlineStagePath,
  runStepsInSession,
  stagePathOf,
} from './session_exec';

describe('inlineStagePath', () => {
  it('routes each language to the extension the runtime dispatches on', () => {
    expect(inlineStagePath('python', 'abc')).toBe('code/.inline/run-abc.py');
    expect(inlineStagePath('node', 'abc')).toBe('code/.inline/run-abc.mjs');
    expect(inlineStagePath('bash', 'abc')).toBe('code/.inline/run-abc.sh');
  });

  it('stages under the hidden code/.inline/ dir, unique per run id', () => {
    const a = inlineStagePath('bash', 'id-a');
    const b = inlineStagePath('bash', 'id-b');
    expect(a.startsWith('code/.inline/')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('round-trips through stagePathOf like every other step path', () => {
    const rel = inlineStagePath('python', 'x');
    expect(stagePathOf(`/user/${rel}`)).toBe(rel);
  });
});

describe('execInputsError', () => {
  it('accepts script, inline, and install-only combinations', () => {
    expect(execInputsError({ stepPaths: ['/user/code/a.py'] })).toBeNull();
    expect(
      execInputsError({ stepPaths: [], inlineCode: { content: 'x' } }),
    ).toBeNull();
    expect(
      execInputsError({
        stepPaths: [],
        packagesByLang: { python: ['pandas'] },
      }),
    ).toBeNull();
  });

  it('rejects steps + inline together and the fully-empty call', () => {
    expect(
      execInputsError({
        stepPaths: ['/user/code/a.py'],
        inlineCode: { content: 'x' },
      }),
    ).toContain('not both');
    expect(execInputsError({ stepPaths: [] })).toContain('requires');
    // Declared-but-empty package buckets don't make an empty call executable.
    expect(
      execInputsError({ stepPaths: [], packagesByLang: { python: [] } }),
    ).toContain('requires');
  });
});

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
