// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  drainSessionExecResilient,
  sessionCancelExec,
  sessionListFiles,
  SessionNotFoundError,
  sessionReadFile,
  sessionStageFiles,
  SpawnerUnreachableError,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { stageUrlForBlobRef } from '../../core/node_only/sandbox/helpers/stage_url.ts';
import { readSkillBundleForViewer } from '../../core/skills/file_actions.ts';
import {
  acquireLightSession,
  LightSandboxBusyError,
  LightSandboxUnavailableError,
  touchLightSession,
} from '../sandbox/light-sessions.ts';
import { prewarmLightSandbox, runRunCode } from './run-code.ts';
import { FULL_LOADOUT, testScope } from './test-helpers.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => {
  class SessionFileTooLargeError extends Error {}
  class MockSessionNotFoundError extends Error {}
  class MockSpawnerUnreachableError extends Error {}
  return {
    SessionFileTooLargeError,
    SessionNotFoundError: MockSessionNotFoundError,
    SpawnerUnreachableError: MockSpawnerUnreachableError,
    drainSessionExecResilient: vi.fn(),
    sessionCancelExec: vi.fn(() => Promise.resolve(true)),
    sessionListFiles: vi.fn(),
    sessionReadFile: vi.fn(),
    sessionStageFiles: vi.fn(),
  };
});
vi.mock('../../core/node_only/sandbox/helpers/stage_url.ts', () => ({
  stageUrlForBlobRef: vi.fn((ref: string) =>
    Promise.resolve(`http://backend-api/api/sandbox-blob?ref=${ref}`),
  ),
}));
vi.mock('../../core/skills/file_actions.ts', () => ({
  readSkillBundleForViewer: vi.fn(),
}));
vi.mock('../sandbox/light-sessions.ts', () => {
  class MockLightSandboxBusyError extends Error {
    readonly kind: 'budget' | 'host';
    constructor(message: string, _retryAfterMs?: number, kind?: 'host') {
      super(message);
      this.kind = kind ?? 'budget';
    }
  }
  class MockLightSandboxUnavailableError extends Error {
    readonly kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  }
  return {
    LightSandboxBusyError: MockLightSandboxBusyError,
    LightSandboxUnavailableError: MockLightSandboxUnavailableError,
    acquireLightSession: vi.fn(() =>
      Promise.resolve({ sessionId: 'lt-1', created: true }),
    ),
    touchLightSession: vi.fn(() => Promise.resolve()),
  };
});

/** How many skipped files a run names before it counts the rest. */
const HARVEST_NAMED = 20;

const b64 = (text: string) => Buffer.from(text).toString('base64');

function execResult(
  overrides: Partial<{
    status: 'completed' | 'failed' | 'cancelled';
    exitCode: number | null;
    stdout: string;
    stderr: string;
    errorCode: string;
  }> = {},
) {
  return {
    status: overrides.status ?? 'completed',
    exitCode: overrides.exitCode === undefined ? 0 : overrides.exitCode,
    durationMs: 120,
    stdoutBase64: b64(overrides.stdout ?? 'done\n'),
    stderrBase64: b64(overrides.stderr ?? ''),
    truncated: { stdout: false, stderr: false },
    ...(overrides.errorCode !== undefined
      ? { errorCode: overrides.errorCode }
      : {}),
  };
}

/**
 * A light sandbox's files as the session client reaches them: the output box
 * a program fills, and every inline file staged in — the delivered-files
 * record among them.
 */
function fakeSandbox() {
  const output = new Map<string, { text: string; mtimeMs: number }>();
  const dirs = new Set<string>();
  const staged = new Map<string, string>();
  /** Files at the top of the working directory, by name. */
  const workspace = new Map<string, number>();
  vi.mocked(sessionListFiles)
    .mockReset()
    .mockImplementation((_sessionId, dirPath) =>
      Promise.resolve(
        dirPath === '/agent/workspace'
          ? [...workspace].map(([name, mtimeMs]) => ({
              name,
              type: 'file' as const,
              size: 1,
              mtimeMs,
            }))
          : [
              ...[...output].map(([name, file]) => ({
                name,
                type: 'file' as const,
                size: Buffer.byteLength(file.text),
                mtimeMs: file.mtimeMs,
              })),
              ...[...dirs].map((name) => ({
                name,
                type: 'dir' as const,
                size: 0,
                mtimeMs: 0,
              })),
            ],
      ),
    );
  vi.mocked(sessionReadFile)
    .mockReset()
    .mockImplementation((_sessionId, path) => {
      const text = path.startsWith('/agent/output/')
        ? output.get(path.slice('/agent/output/'.length))?.text
        : staged.get(path.slice('/agent/'.length));
      return Promise.resolve(
        text === undefined
          ? null
          : {
              bytes: new TextEncoder().encode(text).buffer,
              contentType: 'application/octet-stream',
            },
      );
    });
  vi.mocked(sessionStageFiles)
    .mockReset()
    .mockImplementation((_sessionId, files) => {
      for (const file of files) {
        if (file.contentBase64 !== undefined) {
          staged.set(
            file.path,
            Buffer.from(file.contentBase64, 'base64').toString('utf8'),
          );
        }
      }
      return Promise.resolve({ staged: [], skipped: [] });
    });
  return {
    dirs,
    output,
    workspace,
    write(name: string, text: string, mtimeMs: number) {
      output.set(name, { text, mtimeMs });
    },
    delivered(): unknown {
      const record = staged.get('code/.delivered.json');
      return record === undefined ? undefined : JSON.parse(record);
    },
  };
}

let sandbox: ReturnType<typeof fakeSandbox>;

beforeEach(() => {
  vi.mocked(drainSessionExecResilient)
    .mockReset()
    .mockResolvedValue(execResult());
  sandbox = fakeSandbox();
  vi.mocked(acquireLightSession)
    .mockReset()
    .mockResolvedValue({ sessionId: 'lt-1', created: true });
  vi.mocked(touchLightSession).mockClear();
  vi.mocked(sessionCancelExec).mockReset().mockResolvedValue(true);
});

describe('run_code', () => {
  it('stages the program, runs it in the workspace and attaches the output box', async () => {
    sandbox.write('planets.xlsx', 'PK…', 1_000);
    sandbox.dirs.add('scratch');
    const { scope, stored } = testScope();

    const result = await runRunCode(scope, {
      language: 'python',
      code: 'print("hi")',
    });

    expect(acquireLightSession).toHaveBeenCalledWith(scope.sql, {
      organizationId: 'org_1',
      ownerKey: 'thread-root',
      createdBy: 'user_1',
    });
    const staged = vi.mocked(sessionStageFiles).mock.calls[0]?.[1] ?? [];
    expect(staged[0]?.path).toMatch(/^code\/run-[0-9a-f]{12}\.py$/);
    expect(staged[0]?.contentBase64).toBe(b64('print("hi")'));
    const exec = vi.mocked(drainSessionExecResilient).mock.calls[0]?.[1];
    expect(exec?.command).toEqual(['python3', `/agent/${staged[0]?.path}`]);
    expect(exec?.cwd).toBe('/agent/workspace');
    // Charts keep their font cache in the workspace and draw without a screen.
    expect(exec?.env).toEqual({
      MPLCONFIGDIR: '/agent/workspace/.cache/matplotlib',
      MPLBACKEND: 'Agg',
    });
    expect(exec?.timeoutMs).toBe(60_000);
    expect(stored).toEqual([
      expect.objectContaining({
        name: 'planets.xlsx',
        mediaType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ]);
    // The file stays for later calls; the sandbox records it as delivered.
    expect(sandbox.output.has('planets.xlsx')).toBe(true);
    expect(sandbox.delivered()).toEqual({
      'planets.xlsx': {
        size: Buffer.byteLength('PK…'),
        mtimeMs: 1_000,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        ref: 's3:acme/out-1',
      },
    });
    expect(touchLightSession).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'ok',
      exitCode: 0,
      stdout: 'done\n',
      sandbox: 'started',
      artifacts: [{ ref: 's3:acme/out-1', name: 'planets.xlsx' }],
      skippedOutputs: [{ name: 'scratch' }],
    });
  });

  it('attaches each version of a file once, and keeps the file in place [CHAT-R24]', async () => {
    const { scope, stored } = testScope();
    const run = () =>
      runRunCode(scope, { language: 'python', code: 'print(1)' });

    sandbox.write('report.csv', 'a,b\n1,2\n', 1_000);
    await expect(run()).resolves.toMatchObject({
      artifacts: [{ name: 'report.csv' }],
    });

    // Untouched since: not read again, not attached again.
    vi.mocked(sessionReadFile).mockClear();
    await expect(run()).resolves.toMatchObject({ artifacts: [] });
    expect(sessionReadFile).not.toHaveBeenCalledWith(
      'lt-1',
      '/agent/output/report.csv',
      expect.anything(),
    );

    // Rewritten with the same bytes: read, and still not attached.
    sandbox.write('report.csv', 'a,b\n1,2\n', 2_000);
    await expect(run()).resolves.toMatchObject({ artifacts: [] });

    // Changed: the new version is attached.
    sandbox.write('report.csv', 'a,b\n1,2\n3,4\n', 3_000);
    await expect(run()).resolves.toMatchObject({
      artifacts: [{ name: 'report.csv' }],
    });

    expect(stored.map((file) => file.text)).toEqual([
      'a,b\n1,2\n',
      'a,b\n1,2\n3,4\n',
    ]);
    expect(sandbox.output.has('report.csv')).toBe(true);
  });

  it('delivers a version again when the conversation no longer shows it — a reply tried again [CHAT-R24]', async () => {
    const { scope, stored } = testScope();
    const run = (shownFiles?: ReadonlySet<string>) =>
      runRunCode(
        scope,
        { language: 'python', code: 'print(1)' },
        shownFiles === undefined ? {} : { shownFiles },
      );

    sandbox.write('chart.png', 'png-bytes', 1_000);
    const first = await run(new Set());
    expect(first).toMatchObject({ artifacts: [{ name: 'chart.png' }] });
    const ref = 's3:acme/out-1';

    // The reply that got it is still shown: the same bytes stay delivered.
    await expect(run(new Set([ref]))).resolves.toMatchObject({
      artifacts: [],
    });
    sandbox.write('chart.png', 'png-bytes', 2_000);
    await expect(run(new Set([ref]))).resolves.toMatchObject({
      artifacts: [],
    });

    // Tried again: the shown version of the conversation does not have it,
    // so the same bytes come again — once.
    await expect(run(new Set())).resolves.toMatchObject({
      artifacts: [{ name: 'chart.png' }],
    });
    await expect(run(new Set(['s3:acme/out-2']))).resolves.toMatchObject({
      artifacts: [],
    });
    expect(stored.map((file) => file.text)).toEqual(['png-bytes', 'png-bytes']);
  });

  it('trusts a delivery recorded before deliveries named their file', async () => {
    const { scope, stored } = testScope();
    sandbox.write('notes.md', '# Notes', 1_000);
    vi.mocked(sessionStageFiles).mockClear();
    await runRunCode(
      scope,
      { language: 'python', code: 'print(1)' },
      { shownFiles: new Set() },
    );
    const record = sandbox.delivered() as Record<
      string,
      Record<string, unknown>
    >;
    // A record without the ref, as an older platform wrote it.
    const { ref: _ref, ...legacy } = record['notes.md'] ?? {};
    await sessionStageFiles('lt-1', [
      {
        path: 'code/.delivered.json',
        contentBase64: Buffer.from(
          JSON.stringify({ 'notes.md': legacy }),
        ).toString('base64'),
      },
    ]);

    await expect(
      runRunCode(
        scope,
        { language: 'python', code: 'print(1)' },
        { shownFiles: new Set() },
      ),
    ).resolves.toMatchObject({ artifacts: [] });
    expect(stored).toHaveLength(1);
  });

  it('forgets a file that left the output box, and delivers it anew when it is back', async () => {
    const { scope, stored } = testScope();
    const run = () =>
      runRunCode(scope, { language: 'python', code: 'print(1)' });

    sandbox.write('chart.png', 'png-1', 1_000);
    await run();
    sandbox.output.delete('chart.png');
    await run();
    expect(sandbox.delivered()).toEqual({});

    sandbox.write('chart.png', 'png-1', 1_000);
    await expect(run()).resolves.toMatchObject({
      artifacts: [{ name: 'chart.png' }],
    });
    expect(stored).toHaveLength(2);
  });

  it('delivers again rather than lose a file when the record is unreadable', async () => {
    const { scope, stored } = testScope();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sandbox.write('notes.md', '# Notes', 1_000);
    await runRunCode(scope, { language: 'python', code: 'print(1)' });

    // A program overwrote the record with something else.
    await sessionStageFiles('lt-1', [
      {
        path: 'code/.delivered.json',
        contentBase64: Buffer.from('{"notes.md": 1}').toString('base64'),
      },
    ]);
    await runRunCode(scope, { language: 'python', code: 'print(1)' });

    expect(stored.map((file) => file.name)).toEqual(['notes.md', 'notes.md']);
    expect(warn).toHaveBeenCalledWith(
      '[run_code] the delivered-files record is malformed:',
      expect.any(String),
    );
    warn.mockRestore();
  });

  it('copies the conversation’s files and the named skills in before the run', async () => {
    vi.mocked(readSkillBundleForViewer).mockResolvedValue({
      files: [
        { path: 'SKILL.md', contentBase64: b64('# docx') },
        { path: 'scripts/pack.py', contentBase64: b64('print(1)') },
      ],
    });
    const { scope } = testScope({
      files: [
        {
          ref: 's3:acme/in-1',
          name: 'Q3 numbers.xlsx',
          mediaType: 'x',
          sizeBytes: 900,
        },
      ],
    });

    const result = await runRunCode(scope, {
      language: 'node',
      code: 'console.log(1)',
      files: ['s3:acme/in-1'],
      skills: ['docx'],
    });

    expect(stageUrlForBlobRef).toHaveBeenCalledWith(
      's3:acme/in-1',
      'org_1',
      900,
      900,
    );
    const [, files, options] = vi.mocked(sessionStageFiles).mock.calls[0] ?? [];
    expect(files?.map((file) => file.path)).toEqual([
      expect.stringMatching(/^code\/run-.*\.js$/),
      'inputs/Q3 numbers.xlsx',
      'skills/docx/SKILL.md',
      'skills/docx/scripts/pack.py',
    ]);
    expect(options).toEqual({ reuse: true, replaceRoots: ['skills/docx'] });
    expect(result).toMatchObject({
      inputs: ['/agent/inputs/Q3 numbers.xlsx'],
    });
  });

  it('refuses a ref of another conversation before any sandbox starts [CHAT-R19]', async () => {
    const { scope } = testScope();
    const result = await runRunCode(scope, {
      language: 'python',
      code: 'print(1)',
      files: ['s3:other/secret'],
    });
    expect(result).toMatchObject({ status: 'not_found' });
    expect(acquireLightSession).not.toHaveBeenCalled();
  });

  it.each([
    [{ language: 'ruby', code: 'puts 1' }, /"language"/],
    [{ language: 'python', code: '' }, /"code"/],
    [{ language: 'python', code: 'x', timeoutSeconds: 999 }, /timeoutSeconds/],
    [{ language: 'python', code: 'x', files: 'a' }, /"files"/],
  ])('answers bad arguments %j without a sandbox', async (input, reason) => {
    const { scope } = testScope();
    const result = await runRunCode(scope, input);
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect((result as { message: string }).message).toMatch(reason);
    expect(acquireLightSession).not.toHaveBeenCalled();
  });

  it('reports a failed program with its output, and still attaches what it wrote', async () => {
    vi.mocked(drainSessionExecResilient).mockResolvedValue(
      execResult({
        exitCode: 1,
        stdout: 'starting\n',
        stderr: "ModuleNotFoundError: No module named 'docx'",
      }),
    );
    const { scope } = testScope();
    const result = await runRunCode(scope, {
      language: 'python',
      code: 'import docx',
    });
    expect(result).toMatchObject({
      status: 'error',
      reason: 'program_failed',
      exitCode: 1,
      stderr: "ModuleNotFoundError: No module named 'docx'",
    });
    expect(JSON.stringify(result)).toContain('exit code 1');
  });

  it('says a program ran past its deadline', async () => {
    vi.mocked(drainSessionExecResilient).mockResolvedValue(
      execResult({ status: 'failed', exitCode: null, errorCode: 'TIMEOUT' }),
    );
    const { scope } = testScope();
    const result = await runRunCode(scope, {
      language: 'bash',
      code: 'sleep 999',
      timeoutSeconds: 5,
    });
    expect(result).toMatchObject({ status: 'error', reason: 'timed_out' });
    expect(JSON.stringify(result)).toContain('5-second deadline');
    expect(
      vi.mocked(drainSessionExecResilient).mock.calls[0]?.[1],
    ).toMatchObject({
      command: ['bash', expect.stringMatching(/\.sh$/)],
      timeoutMs: 5_000,
    });
  });

  it('answers busy when no light sandbox can be had now', async () => {
    vi.mocked(acquireLightSession).mockRejectedValueOnce(
      new LightSandboxBusyError('All light sandboxes are in use.'),
    );
    const { scope } = testScope();
    await expect(
      runRunCode(scope, { language: 'python', code: 'print(1)' }),
    ).resolves.toMatchObject({ status: 'busy', reason: 'sandboxes_busy' });
  });

  it('tells a busy sandbox host from a full budget [CHAT-R30]', async () => {
    vi.mocked(acquireLightSession).mockRejectedValueOnce(
      new LightSandboxBusyError(
        'The sandbox host is busy right now.',
        5_000,
        'host',
      ),
    );
    const { scope } = testScope();
    await expect(
      runRunCode(scope, { language: 'python', code: 'print(1)' }),
    ).resolves.toMatchObject({ status: 'busy', reason: 'sandbox_host_busy' });
  });

  describe('when no light sandbox can start [CHAT-R30]', () => {
    it.each([
      ['not_ready', 'sandbox_not_ready', /try again in a few minutes/],
      ['unreachable', 'sandbox_unreachable', /do not call run_code again/],
      ['failed', 'sandbox_failed', /call run_code once more/],
    ] as const)(
      'answers unavailable with the reason when the host is %s',
      async (kind, reason, advice) => {
        vi.mocked(acquireLightSession).mockRejectedValueOnce(
          new LightSandboxUnavailableError(kind, 'spawner said no'),
        );
        const { scope } = testScope();
        const result = await runRunCode(scope, {
          language: 'python',
          code: 'print(1)',
        });
        expect(result).toMatchObject({ status: 'unavailable', reason });
        expect((result as { message: string }).message).toMatch(advice);
        // The spawner's own words stay in the log, never with the model.
        expect(JSON.stringify(result)).not.toContain('spawner said no');
      },
    );

    it('answers unavailable when the sandbox service stops answering during the run', async () => {
      vi.mocked(drainSessionExecResilient).mockRejectedValueOnce(
        new SpawnerUnreachableError(
          'GET',
          '/v1/sessions/lt-1/exec',
          'http://sandbox:8003',
          new Error('connect ECONNREFUSED'),
        ),
      );
      const { scope } = testScope();
      await expect(
        runRunCode(scope, { language: 'python', code: 'print(1)' }),
      ).resolves.toMatchObject({
        status: 'unavailable',
        reason: 'sandbox_unreachable',
      });
    });

    it('asks for a fresh run when the sandbox was gone under the call', async () => {
      vi.mocked(sessionStageFiles).mockRejectedValueOnce(
        new SessionNotFoundError('session lt-1 not found'),
      );
      const { scope } = testScope();
      const result = await runRunCode(scope, {
        language: 'python',
        code: 'print(1)',
      });
      expect(result).toMatchObject({
        status: 'unavailable',
        reason: 'sandbox_failed',
      });
      expect((result as { message: string }).message).toMatch(
        /fresh sandbox starts/,
      );
    });

    it('leaves any other fault to the executor', async () => {
      vi.mocked(drainSessionExecResilient).mockRejectedValueOnce(
        new Error('a bug'),
      );
      const { scope } = testScope();
      await expect(
        runRunCode(scope, { language: 'python', code: 'print(1)' }),
      ).rejects.toThrow('a bug');
    });
  });

  it('cuts off a program whose sandbox stopped answering about it, and says it ran out of time', async () => {
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal);
    vi.mocked(drainSessionExecResilient).mockImplementationOnce(
      (_sessionId, _request, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
          deadline.abort();
        }),
    );
    const { scope } = testScope();
    const result = await runRunCode(scope, {
      language: 'python',
      code: 'import time; time.sleep(999)',
      timeoutSeconds: 30,
    });
    timeout.mockRestore();
    expect(result).toMatchObject({ status: 'error', reason: 'timed_out' });
    expect((result as { message: string }).message).toMatch(
      /30-second deadline/,
    );
    expect(sessionCancelExec).toHaveBeenCalled();
  });

  describe('when every light sandbox is running code', () => {
    const busy = () =>
      new LightSandboxBusyError('All light sandboxes are in use.');

    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks once for a lane with nobody to ask again no more than a chat does', async () => {
      vi.mocked(acquireLightSession).mockRejectedValue(busy());
      const { scope } = testScope();

      await expect(
        runRunCode(scope, { language: 'python', code: 'print(1)' }),
      ).resolves.toMatchObject({ status: 'busy' });

      expect(acquireLightSession).toHaveBeenCalledTimes(1);
    });

    it('waits for one to come free when its lane gives it patience, and then runs the code', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLightSession)
        .mockRejectedValueOnce(busy())
        .mockRejectedValueOnce(busy())
        .mockResolvedValueOnce({ sessionId: 'lt-1', created: true });
      const { scope } = testScope({ lightSandboxWaitMs: 90_000 });

      const running = runRunCode(scope, {
        language: 'python',
        code: 'print(1)',
      });
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(running).resolves.toMatchObject({ status: 'ok' });
      expect(acquireLightSession).toHaveBeenCalledTimes(3);
    });

    it('gives up once its patience is spent, saying so as a chat would', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLightSession).mockRejectedValue(busy());
      const { scope } = testScope({ lightSandboxWaitMs: 10_000 });

      const running = runRunCode(scope, {
        language: 'python',
        code: 'print(1)',
      });
      await vi.advanceTimersByTimeAsync(30_000);

      await expect(running).resolves.toMatchObject({
        status: 'busy',
        message: expect.stringContaining('All light sandboxes are in use.'),
      });
      // Every three seconds inside ten, and not once beyond it.
      expect(
        vi.mocked(acquireLightSession).mock.calls.length,
      ).toBeLessThanOrEqual(5);
      expect(vi.mocked(acquireLightSession).mock.calls.length).toBeGreaterThan(
        2,
      );
    });

    it('does not wait out a failure that is not a busy host', async () => {
      vi.mocked(acquireLightSession).mockRejectedValue(
        new Error('spawner down'),
      );
      const { scope } = testScope({ lightSandboxWaitMs: 90_000 });

      await expect(
        runRunCode(scope, { language: 'python', code: 'print(1)' }),
      ).rejects.toThrow('spawner down');

      expect(acquireLightSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the reply is stopped or the step runs out of time [CHAT-R25]', () => {
    const PROGRAM = {
      language: 'python',
      code: 'import time; time.sleep(170)',
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts nothing for a call that was already told to stop', async () => {
      const { scope } = testScope();
      const stop = new AbortController();
      stop.abort();

      await expect(
        runRunCode(scope, PROGRAM, { signal: stop.signal }),
      ).resolves.toMatchObject({ status: 'cancelled' });

      expect(acquireLightSession).not.toHaveBeenCalled();
      expect(drainSessionExecResilient).not.toHaveBeenCalled();
    });

    it('cuts the program off in its sandbox, and answers that it was stopped', async () => {
      const stop = new AbortController();
      vi.mocked(drainSessionExecResilient).mockImplementation(
        (_sessionId, _body, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      );
      const { scope, stored } = testScope();
      sandbox.write('half.csv', 'a,b', 1_000);

      const running = runRunCode(scope, PROGRAM, { signal: stop.signal });
      await vi.waitFor(() =>
        expect(drainSessionExecResilient).toHaveBeenCalledOnce(),
      );
      stop.abort();

      await expect(running).resolves.toMatchObject({
        status: 'cancelled',
        message: expect.stringContaining('stopped'),
      });
      // What it had written stays, and the model is told where.
      await expect(running).resolves.toMatchObject({
        message: expect.stringContaining('/agent/output/'),
      });
      // The program must not run on in a sandbox nobody waits for.
      const execId = vi.mocked(drainSessionExecResilient).mock.calls[0]?.[1]
        .execId;
      expect(sessionCancelExec).toHaveBeenCalledExactlyOnceWith('lt-1', execId);
      // And the half-written output is not attached to a stopped reply.
      expect(stored).toEqual([]);
    });

    it('still answers when the spawner cannot be asked to cancel', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const stop = new AbortController();
      vi.mocked(drainSessionExecResilient).mockImplementation(
        (_sessionId, _body, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      );
      vi.mocked(sessionCancelExec).mockRejectedValue(new Error('spawner down'));
      const { scope } = testScope();

      const running = runRunCode(scope, PROGRAM, { signal: stop.signal });
      await vi.waitFor(() =>
        expect(drainSessionExecResilient).toHaveBeenCalledOnce(),
      );
      stop.abort();

      await expect(running).resolves.toMatchObject({ status: 'cancelled' });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('stopping the program'),
        expect.any(Error),
      );
    });

    it('asks again when the sandbox does not know the program yet: the cancel can overtake its start', async () => {
      vi.useFakeTimers();
      const stop = new AbortController();
      vi.mocked(drainSessionExecResilient).mockImplementation(
        (_sessionId, _body, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      );
      // The first two cancels reach the sandbox before the program is
      // registered there; the third finds it.
      vi.mocked(sessionCancelExec)
        .mockReset()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const { scope } = testScope();

      const running = runRunCode(scope, PROGRAM, { signal: stop.signal });
      await vi.waitFor(() =>
        expect(drainSessionExecResilient).toHaveBeenCalledOnce(),
      );
      stop.abort();
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(running).resolves.toMatchObject({ status: 'cancelled' });
      expect(sessionCancelExec).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('gives up asking after a few tries when the program is already gone', async () => {
      vi.useFakeTimers();
      const stop = new AbortController();
      vi.mocked(drainSessionExecResilient).mockImplementation(
        (_sessionId, _body, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      );
      vi.mocked(sessionCancelExec).mockReset().mockResolvedValue(false);
      const { scope } = testScope();

      const running = runRunCode(scope, PROGRAM, { signal: stop.signal });
      await vi.waitFor(() =>
        expect(drainSessionExecResilient).toHaveBeenCalledOnce(),
      );
      stop.abort();
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(running).resolves.toMatchObject({ status: 'cancelled' });
      expect(sessionCancelExec).toHaveBeenCalledTimes(4);
    });

    it('records nothing as delivered when a Stop ends the harvest between two files, so no file is lost to a reply that never got it', async () => {
      const stop = new AbortController();
      sandbox.write('a.csv', 'a', 2_000);
      sandbox.write('b.csv', 'b', 1_000);
      const { scope, stored } = testScope();
      // The newest file is being read when the Stop arrives.
      const read = vi.mocked(sessionReadFile).getMockImplementation();
      vi.mocked(sessionReadFile).mockImplementation((...args) => {
        if (args[1].endsWith('/a.csv')) stop.abort();
        return read?.(...args) ?? Promise.resolve(null);
      });

      await runRunCode(scope, PROGRAM, { signal: stop.signal });

      // What was stored is stored, but the record of delivered files was not
      // touched: the next call offers every file again.
      expect(stored.map((file) => file.name)).toEqual(['a.csv']);
      expect(sandbox.delivered()).toBeUndefined();

      vi.mocked(sessionReadFile).mockImplementation(
        (...args) => read?.(...args) ?? Promise.resolve(null),
      );
      await runRunCode(scope, { language: 'python', code: 'print(1)' });
      expect(stored.map((file) => file.name)).toContain('b.csv');
    });

    it('stops waiting for a sandbox the moment it is told to', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLightSession).mockRejectedValue(
        new LightSandboxBusyError('All light sandboxes are in use.'),
      );
      const { scope } = testScope({ lightSandboxWaitMs: 90_000 });
      const stop = new AbortController();

      const running = runRunCode(scope, PROGRAM, { signal: stop.signal });
      await vi.advanceTimersByTimeAsync(4_000);
      stop.abort();
      await vi.advanceTimersByTimeAsync(0);

      await expect(running).resolves.toMatchObject({ status: 'cancelled' });
      // Not the 90 seconds it would have waited, and no timer left behind.
      expect(vi.getTimerCount()).toBe(0);
    });

    it('starts nothing for a call that waited its turn behind another program and was told to stop meanwhile', async () => {
      const stop = new AbortController();
      let finishFirst: (() => void) | undefined;
      vi.mocked(drainSessionExecResilient).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = () => resolve(execResult());
          }),
      );
      const { scope } = testScope();

      const first = runRunCode(scope, { language: 'python', code: 'print(1)' });
      await vi.waitFor(() =>
        expect(drainSessionExecResilient).toHaveBeenCalledOnce(),
      );
      const second = runRunCode(scope, PROGRAM, { signal: stop.signal });
      // The second call is parked behind the first in the sandbox's queue.
      await vi.waitFor(() =>
        expect(acquireLightSession).toHaveBeenCalledTimes(2),
      );
      stop.abort();
      finishFirst?.();

      await expect(first).resolves.toMatchObject({ status: 'ok' });
      await expect(second).resolves.toMatchObject({ status: 'cancelled' });
      expect(drainSessionExecResilient).toHaveBeenCalledOnce();
    });
  });

  it('keeps the answer small when a program floods its output box [CHAT-R27]', async () => {
    // A program can write as many files as it likes; the tool result, the
    // reply's record and the next prompt must not grow with them.
    for (let index = 0; index < 150; index += 1) {
      sandbox.write(`file-${String(index).padStart(3, '0')}.txt`, 'x', 1_000);
    }
    for (let index = 0; index < 120; index += 1)
      sandbox.dirs.add(`dir-${index}`);
    const { scope, stored } = testScope();

    const result = await runRunCode(scope, {
      language: 'python',
      code: 'print(1)',
    });

    // Ten files attach, as always; of the rest only a short list is named, and
    // the others are counted.
    expect(stored).toHaveLength(10);
    const skipped = (result as { skippedOutputs: { name: string }[] })
      .skippedOutputs;
    expect(skipped.length).toBeLessThanOrEqual(21);
    expect(skipped.at(-1)?.name).toMatch(/^\d+ more$/);
    // 270 entries: 200 looked at (10 attached, 190 skipped), 70 never looked at.
    expect(Number.parseInt(skipped.at(-1)?.name ?? '0', 10)).toBe(
      270 - 10 - HARVEST_NAMED,
    );
    expect(JSON.stringify(result).length).toBeLessThan(6_000);
  });

  it('looks at the newest files first, so what the program just wrote is never behind a window of old files [CHAT-R27]', async () => {
    // The sandbox lists in its own order; the fresh file comes last.
    for (let index = 0; index < 250; index += 1) {
      sandbox.write(`old-${String(index).padStart(3, '0')}.txt`, 'x', 1_000);
    }
    sandbox.write('fresh.txt', 'fresh', 5_000);
    const { scope, stored } = testScope();

    await runRunCode(scope, { language: 'python', code: 'print(1)' });

    expect(stored.map((file) => file.name)).toContain('fresh.txt');
    expect(stored).toHaveLength(10);
  });

  it('keeps a delivered file recorded while it is beyond the window, so it is not attached again when it is back in view [CHAT-R24]', async () => {
    const { scope, stored } = testScope();
    const run = () =>
      runRunCode(scope, { language: 'python', code: 'print(1)' });
    sandbox.write('keep.csv', 'a,b', 1_000);
    await run();

    // A program writes more new files than one call looks at; the sandbox
    // lists the delivered one last, and it is the oldest.
    sandbox.output.delete('keep.csv');
    for (let index = 0; index < 205; index += 1) {
      sandbox.write(`new-${String(index).padStart(3, '0')}.txt`, 'n', 2_000);
    }
    sandbox.write('keep.csv', 'a,b', 1_000);
    await run();
    expect(sandbox.delivered()).toHaveProperty(['keep.csv']);

    // The new files go; the delivered one is the whole box again.
    for (const name of sandbox.output.keys()) {
      if (name !== 'keep.csv') sandbox.output.delete(name);
    }
    await expect(run()).resolves.toMatchObject({ artifacts: [] });
    expect(stored.filter((file) => file.name === 'keep.csv')).toHaveLength(1);
  });

  it('notes when a successful program attached nothing', async () => {
    const { scope } = testScope();
    const result = await runRunCode(scope, {
      language: 'python',
      code: 'print(1)',
    });
    expect(result).toMatchObject({ status: 'ok', artifacts: [] });
    expect(JSON.stringify(result)).toContain('/agent/output/');
  });

  it('names the files a program left in its working directory instead of the output box', async () => {
    sandbox.workspace.set('notes.txt', 1_000);
    sandbox.workspace.set('output.xlsx', 2_000);
    sandbox.workspace.set('.hidden', 3_000);
    const { scope } = testScope();
    const result = await runRunCode(scope, {
      language: 'python',
      code: "wb.save('output.xlsx')",
    });
    expect(result).toMatchObject({ status: 'ok', artifacts: [] });
    expect((result as { note: string }).note).toContain(
      '/agent/workspace/ holds output.xlsx, notes.txt: write or copy the files the user should get to /agent/output/.',
    );
  });

  it('leaves the note out when the run says why its files were not attached', async () => {
    sandbox.dirs.add('charts');
    const { scope } = testScope();
    const result = await runRunCode(scope, {
      language: 'python',
      code: 'print(1)',
    });
    expect(result).toMatchObject({
      status: 'ok',
      artifacts: [],
      skippedOutputs: [{ name: 'charts' }],
    });
    expect(result).not.toHaveProperty('note');
  });
});

describe('prewarmLightSandbox', () => {
  it('starts the sandbox only for a turn that may run code', () => {
    prewarmLightSandbox(testScope().scope);
    expect(acquireLightSession).toHaveBeenCalledOnce();
    vi.mocked(acquireLightSession).mockClear();
    prewarmLightSandbox(
      testScope({ loadout: { ...FULL_LOADOUT, runCode: false } }).scope,
    );
    expect(acquireLightSession).not.toHaveBeenCalled();
  });
});
