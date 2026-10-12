// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  drainSessionExecResilient,
  sessionListFiles,
  sessionReadFile,
  sessionStageFiles,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { stageUrlForBlobRef } from '../../core/node_only/sandbox/helpers/stage_url.ts';
import { readSkillBundleForViewer } from '../../core/skills/file_actions.ts';
import {
  acquireLightSession,
  LightSandboxBusyError,
  touchLightSession,
} from '../sandbox/light-sessions.ts';
import { prewarmLightSandbox, runRunCode } from './run-code.ts';
import { FULL_LOADOUT, testScope } from './test-helpers.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => {
  class SessionFileTooLargeError extends Error {}
  return {
    SessionFileTooLargeError,
    drainSessionExecResilient: vi.fn(),
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
  class MockLightSandboxBusyError extends Error {}
  return {
    LightSandboxBusyError: MockLightSandboxBusyError,
    acquireLightSession: vi.fn(() =>
      Promise.resolve({ sessionId: 'lt-1', created: true }),
    ),
    touchLightSession: vi.fn(() => Promise.resolve()),
  };
});

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
  vi.mocked(sessionListFiles)
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve([
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
      ]),
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
  vi.mocked(acquireLightSession).mockClear();
  vi.mocked(touchLightSession).mockClear();
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
    expect(result).toMatchObject({ status: 'error' });
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
    ).resolves.toMatchObject({ status: 'busy' });
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
