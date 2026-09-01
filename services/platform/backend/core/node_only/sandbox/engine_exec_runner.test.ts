// The session-bound program runner: locks the exec shape (`node -e`, output
// collected, deadline forwarded) and the result mapping — most importantly
// that the spawner's `errorCode: 'TIMEOUT'` becomes the transport's
// `timedOut`, which is the whole reason this backend is a boundary.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDrain = vi.fn();
vi.mock('./helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) => mockDrain(...args),
}));

import { sandboxProgramRunnerForSession } from './engine_exec_runner';

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('sandboxProgramRunnerForSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs `node -e <program>` one-shot in the session with the deadline', async () => {
    mockDrain.mockResolvedValue({
      status: 'completed',
      exitCode: 0,
      durationMs: 5,
      stdoutBase64: b64('<<TALE_RUNNER_RESULT<<{"v":1}>>TALE_RUNNER_RESULT>>'),
      stderrBase64: b64(''),
      truncated: { stdout: false, stderr: false },
    });
    const run = sandboxProgramRunnerForSession('session_1');

    const result = await run('process.stdout.write("x")', 12_345);

    expect(mockDrain).toHaveBeenCalledWith(
      'session_1',
      expect.objectContaining({
        command: ['node', '-e', 'process.stdout.write("x")'],
        cwd: '/agent',
        collectOutput: true,
        timeoutMs: 12_345,
      }),
      expect.anything(),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false,
      stdout: expect.stringContaining('{"v":1}'),
    });
  });

  it("maps the spawner's TIMEOUT errorCode to timedOut", async () => {
    mockDrain.mockResolvedValue({
      status: 'failed',
      exitCode: 137,
      durationMs: 12_400,
      stdoutBase64: b64(''),
      stderrBase64: b64('killed'),
      truncated: { stdout: false, stderr: false },
      errorCode: 'TIMEOUT',
    });
    const run = sandboxProgramRunnerForSession('session_1');

    const result = await run('while(true){}', 12_000);

    expect(result.timedOut).toBe(true);
    expect(result.stderr).toBe('killed');
  });

  it('reports a plain crash as its exit code, not a timeout', async () => {
    mockDrain.mockResolvedValue({
      status: 'failed',
      exitCode: 1,
      durationMs: 8,
      stdoutBase64: b64(''),
      stderrBase64: b64('sandbox-exec body error: boom'),
      truncated: { stdout: false, stderr: false },
    });
    const run = sandboxProgramRunnerForSession('session_1');

    const result = await run('throw new Error("boom")', 5_000);

    expect(result).toMatchObject({ exitCode: 1, timedOut: false });
    expect(result.stderr).toContain('boom');
  });
});
