// run_code arg-schema mode mutex (entryPath / steps / code) + the
// terminal-output result message. Pure zod + string formatting — the only
// mock is createTool so importing the tool module doesn't pull the agent
// runtime.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def: unknown) => def),
}));

import { formatRunCodeResultMessage, runCodeArgs } from './run_code_tool';

describe('runCodeArgs', () => {
  it('accepts each mode alone', () => {
    expect(
      runCodeArgs.safeParse({ entryPath: '/user/code/a.py' }).success,
    ).toBe(true);
    expect(
      runCodeArgs.safeParse({ steps: [{ path: '/user/code/a.py' }] }).success,
    ).toBe(true);
    expect(
      runCodeArgs.safeParse({ code: 'print(1)', language: 'python' }).success,
    ).toBe(true);
  });

  it('rejects zero modes and combined modes', () => {
    expect(runCodeArgs.safeParse({}).success).toBe(false);
    expect(
      runCodeArgs.safeParse({
        entryPath: '/user/code/a.py',
        code: 'echo hi',
        language: 'bash',
      }).success,
    ).toBe(false);
    expect(
      runCodeArgs.safeParse({
        entryPath: '/user/code/a.py',
        steps: [{ path: '/user/code/b.py' }],
      }).success,
    ).toBe(false);
  });

  it('ties language to code in both directions', () => {
    const missing = runCodeArgs.safeParse({ code: 'echo hi' });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues.some((i) => i.path[0] === 'language')).toBe(
        true,
      );
    }
    expect(
      runCodeArgs.safeParse({
        entryPath: '/user/code/a.py',
        language: 'bash',
      }).success,
    ).toBe(false);
  });
});

const baseRun = {
  status: 'completed' as const,
  exitCode: 0,
  stdoutPreview: '',
  stderrPreview: '',
  durationMs: 42,
  files: [] as Array<{ path: string }>,
};

describe('formatRunCodeResultMessage', () => {
  it('embeds stdout as a fenced terminal block', () => {
    const msg = formatRunCodeResultMessage({
      ...baseRun,
      stdoutPreview: 'total 0\ndrwxr-xr-x output\n',
    });
    expect(msg).toContain('stdout:\n```\ntotal 0\ndrwxr-xr-x output\n```');
    // Short note replaces the long harvest lecture when there IS output.
    expect(msg).not.toContain('Wrong (file is lost');
  });

  it('keeps the harvest hint only when the run produced nothing at all', () => {
    const msg = formatRunCodeResultMessage(baseRun);
    expect(msg).toContain('nothing was printed');
    expect(msg).toContain('/user/output/');
  });

  it('lists harvested files and still appends stdout', () => {
    const msg = formatRunCodeResultMessage({
      ...baseRun,
      files: [{ path: '/user/output/report.pdf' }],
      stdoutPreview: 'wrote report\n',
    });
    expect(msg).toContain('/user/output/report.pdf');
    expect(msg).toContain('stdout:');
  });

  it('shows stderr only on failure', () => {
    const ok = formatRunCodeResultMessage({
      ...baseRun,
      stdoutPreview: 'fine\n',
      stderrPreview: 'pip install noise\n',
    });
    expect(ok).not.toContain('stderr:');

    const failed = formatRunCodeResultMessage({
      ...baseRun,
      status: 'failed',
      exitCode: 1,
      errorCode: 'RUNTIME_ERROR',
      errorMessage: 'boom',
      stderrPreview: 'Traceback: boom\n',
    });
    expect(failed).toContain('run_code FAILED: RUNTIME_ERROR — boom');
    expect(failed).toContain('stderr:\n```\nTraceback: boom\n```');
  });

  it('widens the fence when the output itself contains ```', () => {
    const msg = formatRunCodeResultMessage({
      ...baseRun,
      stdoutPreview: 'a\n```\nb\n',
    });
    expect(msg).toContain('````\na\n```\nb\n````');
  });
});
