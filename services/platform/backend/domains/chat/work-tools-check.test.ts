// @vitest-environment node

/**
 * The Run check of the Chat tool status panel, against a fake sandbox
 * service: it starts a light sandbox through the same path as `run_code`
 * (the light budget, the busy and start failures and their codes), runs its
 * program, reads the Word file back, and answers pass or the one piece that
 * failed — never the service's own words — and its sandbox is gone after.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type SessionExecBody,
  type SessionExecResult,
  SessionNotFoundError,
  SpawnerBusyError,
  SpawnerUnreachableError,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  acquireLightSession,
  destroyLightSession,
  lightSessionId,
  type LightSessionSpawner,
} from '../sandbox/light-sessions.ts';
import {
  markSessionDestroyed,
  reserveSessionSlot,
  SandboxQuotaError,
} from '../sandbox/sessions.ts';
import {
  type ChatSandboxCheckDeps,
  runChatSandboxCheck,
} from './work-tools-check.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => {
  class MockSpawnerBusyError extends Error {
    readonly retryAfterMs: number | undefined;
    readonly refusal: string | undefined;
    constructor(retryAfterMs?: number, _queue?: unknown, refusal?: string) {
      super('busy');
      this.retryAfterMs = retryAfterMs;
      this.refusal = refusal;
    }
  }
  class MockSpawnerUnreachableError extends Error {}
  class MockSessionNotFoundError extends Error {}
  return {
    SpawnerBusyError: MockSpawnerBusyError,
    SpawnerUnreachableError: MockSpawnerUnreachableError,
    SessionNotFoundError: MockSessionNotFoundError,
    drainSessionExecResilient: vi.fn(),
    sessionCreate: vi.fn(),
    sessionDestroy: vi.fn(),
    sessionDestroyIfIdle: vi.fn(),
    sessionIsAlive: vi.fn(),
    sessionReadFile: vi.fn(),
  };
});
vi.mock('../sandbox/sessions.ts', () => {
  class MockSandboxQuotaError extends Error {
    readonly reason: string | undefined;
    constructor(message: string, reason?: string) {
      super(message);
      this.reason = reason;
    }
  }
  return {
    SandboxQuotaError: MockSandboxQuotaError,
    getSessionBySessionId: vi.fn(() => Promise.resolve(null)),
    markSessionDestroyed: vi.fn(() => Promise.resolve(true)),
    reserveSessionSlot: vi.fn(() => Promise.resolve('row-1')),
    setSessionStatus: vi.fn(() => Promise.resolve(true)),
  };
});
vi.mock('./work-tools-status.ts', () => ({ sandboxConfigured: () => true }));

const ORG = 'org_1';
const CALLER = { organizationId: ORG, userId: 'u1' };
/** What the service says when it fails, which no answer may carry. */
const SECRET_WORDS = 'runner at spawner-7.internal:9000 refused token=s3cr3t';

/** A tagged-template fake: no row answers, so the light budget has no
 * idle sandbox to take. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
const sql = (() => Promise.resolve([])) as unknown as Sql;

const unreachable = () =>
  new SpawnerUnreachableError(
    'POST',
    '/v1/sessions',
    SECRET_WORDS,
    new Error(SECRET_WORDS),
  );

function fakeSpawner(
  overrides: Partial<LightSessionSpawner> = {},
): LightSessionSpawner {
  return {
    create: vi.fn(() =>
      Promise.resolve({
        session: {
          sessionId: 'x',
          organizationId: ORG,
          profile: 'default' as const,
          state: 'ready',
          backend: 'docker',
          createdAtMs: 0,
          expiresAtMs: 0,
          idleTimeoutMs: 0,
        },
      }),
    ),
    isAlive: vi.fn(() => Promise.resolve(true)),
    destroy: vi.fn(() => Promise.resolve(true)),
    destroyIfIdle: vi.fn(() =>
      Promise.resolve({ destroyed: true, busy: false }),
    ),
    ...overrides,
  };
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function ran(
  report: unknown,
  overrides: Partial<SessionExecResult> = {},
): SessionExecResult {
  return {
    status: 'completed',
    exitCode: 0,
    durationMs: 900,
    stdoutBase64: base64(`${JSON.stringify(report)}\n`),
    stderrBase64: '',
    truncated: { stdout: false, stderr: false },
    ...overrides,
  };
}

const WORD_FILE = {
  bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).buffer,
};

interface Harness {
  deps: ChatSandboxCheckDeps;
  spawner: LightSessionSpawner;
  exec: ReturnType<typeof vi.fn<ChatSandboxCheckDeps['exec']>>;
  readFile: ReturnType<typeof vi.fn<ChatSandboxCheckDeps['readFile']>>;
  destroy: ReturnType<typeof vi.fn<ChatSandboxCheckDeps['destroy']>>;
}

function harness(
  options: {
    spawner?: Partial<LightSessionSpawner>;
    report?: unknown;
    configured?: boolean;
    deadlineMs?: number;
  } = {},
): Harness {
  const spawner = fakeSpawner(options.spawner);
  const exec = vi.fn<ChatSandboxCheckDeps['exec']>(() =>
    Promise.resolve(
      ran(options.report ?? { listed: 57, missing: [], written: true }),
    ),
  );
  const readFile = vi.fn<ChatSandboxCheckDeps['readFile']>(() =>
    Promise.resolve(WORD_FILE),
  );
  const destroy = vi.fn<ChatSandboxCheckDeps['destroy']>((owner) =>
    destroyLightSession(sql, owner, spawner),
  );
  return {
    spawner,
    exec,
    readFile,
    destroy,
    deps: {
      configured: () => options.configured ?? true,
      acquire: (owner) => acquireLightSession(sql, owner, spawner),
      destroy,
      exec,
      readFile,
      ...(options.deadlineMs === undefined
        ? {}
        : { deadlineMs: options.deadlineMs }),
    },
  };
}

beforeEach(() => {
  vi.mocked(reserveSessionSlot).mockReset().mockResolvedValue('row-1');
  vi.mocked(markSessionDestroyed).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('runChatSandboxCheck', () => {
  it('passes when a light sandbox starts, holds every listed library and writes a Word file [CHAT-R38]', async () => {
    const h = harness();

    const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

    expect(answer).toEqual({
      outcome: 'passed',
      checkedAt: expect.any(Number),
      libraries: 57,
      durationMs: expect.any(Number),
    });
    // A light sandbox of the organization, in its light budget.
    expect(reserveSessionSlot).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ organizationId: ORG, ownerType: 'light' }),
    );
    expect(h.spawner.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, placement: 'server' }),
    );
    const [sessionId, body] = h.exec.mock.calls[0] ?? [];
    const command = (body as SessionExecBody).command ?? [];
    expect(command.slice(0, 2)).toEqual(['python3', '-c']);
    expect(command[2]).toContain('/opt/tale/document-python-requirements.txt');
    expect(command[2]).toContain('/opt/tale/document-node/package.json');
    expect(command[3]).toBe('/agent/output/tale-run-check.docx');
    expect(h.readFile).toHaveBeenCalledWith(
      sessionId,
      '/agent/output/tale-run-check.docx',
      expect.objectContaining({ maxBytes: expect.any(Number) }),
    );
    // Its sandbox is gone after the check.
    expect(h.spawner.destroy).toHaveBeenCalledWith(sessionId);
    expect(markSessionDestroyed).toHaveBeenCalledWith(sql, {
      organizationId: ORG,
      sessionId,
    });
  });

  it('gives each check a sandbox of its own [CHAT-R38]', async () => {
    const h = harness();

    await Promise.all([
      runChatSandboxCheck(sql, CALLER, h.deps),
      runChatSandboxCheck(sql, CALLER, h.deps),
    ]);

    const sessions = h.exec.mock.calls.map(([sessionId]) => sessionId);
    expect(new Set(sessions).size).toBe(2);
    expect(h.spawner.destroy).toHaveBeenCalledTimes(2);
  });

  it('names a deployment without a sandbox service and starts nothing [CHAT-R38]', async () => {
    const h = harness({ configured: false });

    const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

    expect(answer).toEqual({
      outcome: 'failed',
      checkedAt: expect.any(Number),
      failure: { piece: 'sandbox_not_configured' },
    });
    expect(h.spawner.create).not.toHaveBeenCalled();
  });

  it('answers busy as run_code does when every light sandbox of the organization is in use [CHAT-R38]', async () => {
    vi.mocked(reserveSessionSlot).mockRejectedValue(
      new SandboxQuotaError('full'),
    );
    const h = harness();

    const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

    expect(answer).toMatchObject({
      outcome: 'failed',
      failure: { piece: 'sandboxes_busy' },
    });
    expect(h.spawner.create).not.toHaveBeenCalled();
    expect(h.exec).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the host is at its capacity',
      () => new SpawnerBusyError(5_000),
      'sandbox_host_busy',
    ],
    [
      'the host has no runtime image ready',
      () => new SpawnerBusyError(5_000, undefined, 'runtime_image'),
      'sandbox_not_ready',
    ],
    [
      'the sandbox service cannot be reached',
      unreachable,
      'sandbox_unreachable',
    ],
    ['the start failed', () => new Error(SECRET_WORDS), 'sandbox_failed'],
  ])(
    'names the piece when %s, in run_code’s code and never the service’s words [CHAT-R38]',
    async (_case, refusal, piece) => {
      const h = harness({
        spawner: { create: vi.fn(() => Promise.reject(refusal())) },
      });

      const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

      expect(answer).toMatchObject({ outcome: 'failed', failure: { piece } });
      expect(JSON.stringify(answer)).not.toMatch(/spawner-7|s3cr3t|refused/);
      expect(h.exec).not.toHaveBeenCalled();
    },
  );

  it('names the missing libraries the image lists, and only well-formed names [CHAT-R38]', async () => {
    const missing = [
      'python-docx',
      '@scope/pkg',
      'document-node/package.json',
      'pip says: http://10.0.0.5 refused',
      ...Array.from({ length: 30 }, (_, i) => `lib-${i}`),
    ];
    const h = harness({ report: { listed: 57, missing, written: false } });

    const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

    expect(answer).toMatchObject({
      outcome: 'failed',
      failure: { piece: 'libraries_missing', count: missing.length },
    });
    const named =
      answer.outcome === 'failed' &&
      answer.failure.piece === 'libraries_missing'
        ? answer.failure.missing
        : [];
    expect(named.slice(0, 3)).toEqual([
      'python-docx',
      '@scope/pkg',
      'document-node/package.json',
    ]);
    expect(named).toHaveLength(20);
    expect(JSON.stringify(answer)).not.toContain('10.0.0.5');
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.spawner.destroy).toHaveBeenCalled();
  });

  it.each([
    [
      'the program could not write it',
      { written: false },
      () => Promise.resolve(WORD_FILE),
    ],
    ['it is not there to read', { written: true }, () => Promise.resolve(null)],
    [
      'what is there is no Word file',
      { written: true },
      () => Promise.resolve({ bytes: new TextEncoder().encode('oops').buffer }),
    ],
    [
      'reading it back fails',
      { written: true },
      () => Promise.reject(new Error(SECRET_WORDS)),
    ],
  ])('names the file when %s [CHAT-R38]', async (_case, written, read) => {
    const h = harness({ report: { listed: 57, missing: [], ...written } });
    h.readFile.mockImplementation(read);

    const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

    expect(answer).toMatchObject({
      outcome: 'failed',
      failure: { piece: 'file_not_written' },
    });
    expect(JSON.stringify(answer)).not.toMatch(/spawner-7|s3cr3t/);
    expect(h.spawner.destroy).toHaveBeenCalled();
  });

  it.each([
    [
      'the service stops answering',
      () => Promise.reject(unreachable()),
      'sandbox_unreachable',
    ],
    [
      'the sandbox is gone',
      () => Promise.reject(new SessionNotFoundError(SECRET_WORDS)),
      'sandbox_failed',
    ],
    [
      'the service breaks off the program',
      () => Promise.reject(new Error(SECRET_WORDS)),
      'sandbox_failed',
    ],
    [
      'the program crashes',
      () =>
        Promise.resolve(
          ran('', {
            status: 'failed',
            exitCode: 1,
            stderrBase64: base64(SECRET_WORDS),
          }),
        ),
      'sandbox_failed',
    ],
    [
      'the program prints no report',
      () =>
        Promise.resolve({
          ...ran(''),
          stdoutBase64: base64(SECRET_WORDS),
        }),
      'sandbox_failed',
    ],
    [
      'the program runs past its own time',
      () =>
        Promise.resolve(ran('', { status: 'failed', errorCode: 'TIMEOUT' })),
      'timed_out',
    ],
  ])(
    'names the piece when %s under the check, and its sandbox is gone after [CHAT-R38]',
    async (_case, outcome, piece) => {
      const h = harness();
      h.exec.mockImplementation(outcome);

      const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

      expect(answer).toMatchObject({ outcome: 'failed', failure: { piece } });
      expect(JSON.stringify(answer)).not.toMatch(/spawner-7|s3cr3t/);
      expect(h.spawner.destroy).toHaveBeenCalled();
    },
  );

  it('answers timed out when the program outlasts the deadline, and destroys its sandbox [CHAT-R38]', async () => {
    const h = harness({ deadlineMs: 20 });
    h.exec.mockImplementation(
      (_sessionId, _body, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );

    const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

    expect(answer).toMatchObject({
      outcome: 'failed',
      failure: { piece: 'timed_out' },
    });
    expect(h.spawner.destroy).toHaveBeenCalled();
  });

  it('answers timed out when the start outlasts the deadline, and destroys the sandbox once it is up [CHAT-R38]', async () => {
    let started: () => void = () => undefined;
    const h = harness({
      deadlineMs: 20,
      spawner: {
        create: vi.fn(
          () =>
            new Promise<Awaited<ReturnType<LightSessionSpawner['create']>>>(
              (resolve) => {
                started = () => {
                  resolve({ session: {} as never });
                };
              },
            ),
        ),
      },
    });

    const answer = await runChatSandboxCheck(sql, CALLER, h.deps);

    expect(answer).toMatchObject({
      outcome: 'failed',
      failure: { piece: 'timed_out' },
    });
    expect(h.exec).not.toHaveBeenCalled();
    started();
    await vi.waitFor(() => {
      expect(h.spawner.destroy).toHaveBeenCalledWith(
        expect.stringMatching(/^lt-/),
      );
    });
  });

  it('answers by its deadline when destroying its sandbox hangs, and the destroy goes on [CHAT-R38]', async () => {
    let destroyed: (value: boolean) => void = () => undefined;
    const h = harness({
      deadlineMs: 50,
      spawner: {
        destroy: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              destroyed = resolve;
            }),
        ),
      },
    });

    const answer = await Promise.race([
      runChatSandboxCheck(sql, CALLER, h.deps),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('the answer waited for the destroy');
        }, 1_000);
      }),
    ]);

    expect(answer).toMatchObject({ outcome: 'passed' });
    expect(h.spawner.destroy).toHaveBeenCalledOnce();
    expect(markSessionDestroyed).not.toHaveBeenCalled();
    destroyed(true);
    await vi.waitFor(() => {
      expect(markSessionDestroyed).toHaveBeenCalledOnce();
    });
  });

  it('answers timed out at its deadline without waiting for a destroy that fails later [CHAT-R38]', async () => {
    let failDestroy: () => void = () => undefined;
    let destroys = 0;
    const h = harness({ deadlineMs: 20 });
    h.exec.mockImplementation(
      (_sessionId, _body, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    // A plain function, not a mock: a mock handles the rejection itself.
    const destroy: ChatSandboxCheckDeps['destroy'] = () => {
      destroys += 1;
      return new Promise<boolean>((_resolve, reject) => {
        failDestroy = () => {
          reject(new Error(SECRET_WORDS));
        };
      });
    };

    const answer = await Promise.race([
      runChatSandboxCheck(sql, CALLER, { ...h.deps, destroy }),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('the answer waited for the destroy');
        }, 1_000);
      }),
    ]);

    expect(answer).toMatchObject({
      outcome: 'failed',
      failure: { piece: 'timed_out' },
    });
    expect(destroys).toBe(1);
    // Vitest fails the run on a rejection nobody handles.
    failDestroy();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  });

  it('names each check’s own sandbox, never another owner’s [CHAT-R38]', async () => {
    const h = harness();

    await runChatSandboxCheck(sql, CALLER, h.deps);

    const [sessionId] = h.exec.mock.calls[0] ?? [];
    expect(sessionId).not.toBe(lightSessionId(ORG, 'u1'));
    expect(h.destroy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        ownerKey: expect.stringMatching(/^chat-tools-check:/),
      }),
    );
  });
});
