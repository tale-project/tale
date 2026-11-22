// @vitest-environment node

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  SessionExecResult,
  SessionFsEntry,
} from '../node_only/sandbox/helpers/session_client';
import { isRelayProxyUrl, RELAY_POT_PATH } from './relay';
import { verifyVideoRelayToken, videoProxyDigest } from './relay_token';
import { inYtdlpPlace, sessionYtdlpPlace } from './session_place';
import {
  BASE_FLAGS,
  botWallReason,
  cookiesFlagsFromEnv,
  MEDIA_MAX_BYTES,
  potProviderUrl,
  videoIngestLane,
  YtDlpError,
  type YtdlpPlace,
} from './ytdlp';

/**
 * A deployment runs a video's yt-dlp in a sandbox session
 * (tale-project/tale#4942). The spawner's client is replaced at its module
 * boundary: what is held here is what the place asks of a session, and what
 * it makes of a session's answers.
 */

const client = vi.hoisted(() => ({
  exec: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  open: vi.fn(),
  stage: vi.fn(),
  session: vi.fn(),
  /** The client's own refusal of a file that declares more than was asked
   * for. */
  TooLarge: class SessionFileTooLargeError extends Error {},
}));

vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  drainSessionExecResilient: client.exec,
  SessionFileTooLargeError: client.TooLarge,
  sessionListFiles: client.list,
  sessionReadFile: client.read,
  sessionOpenFile: client.open,
  sessionStageFiles: client.stage,
}));
vi.mock('../node_only/sandbox/throwaway_session', () => ({
  withThrowawaySession: client.session,
}));

const KEY = { WEBDAV_APP_PASSWORD_HMAC_KEY: 'k'.repeat(64) };
const b64 = (text: string): string => Buffer.from(text).toString('base64');

/** A run's answer from the session. */
function ran(result: Partial<SessionExecResult>): SessionExecResult {
  return {
    status: 'completed',
    exitCode: 0,
    durationMs: 10,
    stdoutBase64: '',
    stderrBase64: '',
    truncated: { stdout: false, stderr: false },
    ...result,
  };
}

/** What a run that must fail failed with. */
async function failure(run: Promise<unknown>): Promise<YtDlpError> {
  const error = await run.then(
    () => new Error('the run was served'),
    (caught: unknown) => caught,
  );
  if (!(error instanceof YtDlpError)) throw error;
  return error;
}

const place = (env: NodeJS.ProcessEnv = KEY): YtdlpPlace =>
  sessionYtdlpPlace('vid-1', 'job-1', env);

const savedLane = process.env.VIDEO_INGEST_LANE;
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  if (savedLane === undefined) delete process.env.VIDEO_INGEST_LANE;
  else process.env.VIDEO_INGEST_LANE = savedLane;
});

describe('videoIngestLane — where a deployment fetches its videos', () => {
  it.each([
    [undefined, 'sandbox'],
    ['', 'sandbox'],
    ['sandbox', 'sandbox'],
    ['local', 'local'],
    [' Local ', 'local'],
    ['here', 'sandbox'],
  ])('reads %j as %s', (value, lane) => {
    expect(
      videoIngestLane(value === undefined ? {} : { VIDEO_INGEST_LANE: value }),
    ).toBe(lane);
  });
});

describe('whether a video has a PO-token provider to ask', () => {
  // A deployment's own image carries no plugin: its videos are fetched in a
  // session, whose image does. So a provider that is turned on is one the
  // video had, and a bot check with it on is the platform's own wall.
  it('follows the settings alone where videos are fetched in a session', () => {
    expect(potProviderUrl({ VIDEO_INGEST_POT_PROVIDER: 'true' })).toBe(
      'http://bgutil-provider:4416',
    );
    expect(
      botWallReason('youtube', { VIDEO_INGEST_POT_PROVIDER: 'true' }),
    ).toBe('botDetection');
    expect(potProviderUrl({})).toBeUndefined();
    expect(botWallReason('youtube', {})).toBe('poTokenProviderOff');
  });

  it('needs the plugin on this machine too where videos are fetched here', () => {
    // No plugin directory on a test machine.
    const env = {
      VIDEO_INGEST_LANE: 'local',
      VIDEO_INGEST_POT_PROVIDER: 'true',
    };

    expect(potProviderUrl(env)).toBeUndefined();
    expect(botWallReason('youtube', env)).toBe('poTokenProviderOff');
    // A provider named outright needs no plugin of the image's.
    expect(
      potProviderUrl({
        ...env,
        VIDEO_INGEST_POT_PROVIDER_URL: 'http://pot.internal:4416',
      }),
    ).toBe('http://pot.internal:4416');
  });
});

describe('a sandbox session as the place a video is fetched in', () => {
  it('works in a directory every session has, with the flags its pinned yt-dlp takes', async () => {
    const session = place();

    expect(session.dir).toBe('/agent/output');
    expect(await session.commonFlags()).toEqual([...BASE_FLAGS]);
    // No ffmpeg is named: a session has none, and a run converts nothing.
    expect(await session.commonFlags()).not.toContain('--ffmpeg-location');
  });

  describe('runs yt-dlp', () => {
    /** A run whose output comes over the stream, as a session sends it,
     * and that ends with `result`. */
    const streams = (
      said: { stdout?: string[]; stderr?: string[] },
      result: Partial<SessionExecResult>,
    ): void => {
      client.exec.mockImplementation(
        (
          _id: unknown,
          _body: unknown,
          _signal: unknown,
          callbacks: {
            onStdout: (text: string) => void;
            onStderr: (text: string) => void;
          },
        ) => {
          for (const text of said.stdout ?? []) callbacks.onStdout(text);
          for (const text of said.stderr ?? []) callbacks.onStderr(text);
          return Promise.resolve(ran(result));
        },
      );
    };

    it('takes its output from the stream, piece by piece', async () => {
      streams(
        { stdout: ['{"id":', '"x"}'], stderr: ['a ', 'note'] },
        { stdoutBase64: b64('{"id":"x"}'), stderrBase64: b64('a note') },
      );

      expect(await place().run(['-J'], 90_000)).toEqual({
        stdout: '{"id":"x"}',
        stderr: 'a note',
      });
    });

    // A stream that was lost and attached to again ends with a last word
    // that holds no output: it was all on the stream.
    it('has its output when its last word holds none, after a stream that was lost', async () => {
      streams(
        { stdout: ['{"id":"x"}'] },
        { stdoutBase64: '', stderrBase64: '' },
      );

      expect(await place().run(['-J'], 90_000)).toEqual({
        stdout: '{"id":"x"}',
        stderr: '',
      });
    });

    it('is judged by what it said on the stream when its last word holds none', async () => {
      streams(
        { stderr: ['ERROR: [youtube] x: Sign in to confirm you’re not a bot'] },
        { status: 'failed', exitCode: 1, stdoutBase64: '', stderrBase64: '' },
      );

      const error = await failure(place().run(['-J'], 90_000));

      // Its own reason, which sends the video on through another proxy, and
      // not the temporary problem a run without words would be.
      expect(error.reason).toBe('botDetection');
      expect(error.sanitizedStderr).toContain('not a bot');
    });

    it.each(['stdout', 'stderr'] as const)(
      'listens no further to a run that says more than it may on %s',
      async (stream) => {
        const mebibyte = 'x'.repeat(1024 * 1024);
        let stopped: boolean | undefined;
        client.exec.mockImplementation(
          (
            _id: unknown,
            _body: unknown,
            signal: AbortSignal,
            callbacks: {
              onStdout: (text: string) => void;
              onStderr: (text: string) => void;
            },
          ) => {
            // Six mebibytes, one over what a run may say.
            for (let piece = 0; piece < 6; piece += 1) {
              (stream === 'stdout' ? callbacks.onStdout : callbacks.onStderr)(
                mebibyte,
              );
            }
            stopped = signal.aborted;
            return Promise.reject(new Error('the caller stopped listening'));
          },
        );

        const error = await failure(place().run(['-J'], 90_000));

        expect(stopped).toBe(true);
        expect(error.reason).toBe('transient');
        expect(error.message).toBe(
          'yt-dlp output exceeded 5242880 bytes (cap-killed)',
        );
      },
    );

    it('takes exactly what a run may say', async () => {
      const mebibyte = 'x'.repeat(1024 * 1024);
      streams(
        { stdout: [mebibyte, mebibyte, mebibyte, mebibyte, mebibyte] },
        {},
      );

      const result = await place().run(['-J'], 90_000);

      expect(result.stdout.length).toBe(5 * 1024 * 1024);
    });

    // What the spawner's client says of a sandbox it cannot reach names
    // addresses of the deployment's own network: the log's to keep, and
    // none of it the member's to read.
    it('tells a fault of the sandbox as a temporary problem, in words of its own', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      client.exec.mockRejectedValue(
        new Error(
          'sandbox spawner unreachable at http://sandbox:8003 (POST /v1/sessions/vid-1/exec): fetch failed',
        ),
      );

      const error = await failure(place().run(['-J'], 90_000));

      expect(error.reason).toBe('transient');
      expect(error.message).toBe(
        'the sandbox session failed while running yt-dlp',
      );
      expect(error.sanitizedStderr).toBe('');
      expect(warn).toHaveBeenCalledWith(
        '[video_link] the sandbox session failed while running yt-dlp:',
        expect.stringContaining('http://sandbox:8003'),
      );
      warn.mockRestore();
    });

    it('in the session, in its directory, and answers what it wrote', async () => {
      client.exec.mockResolvedValue(
        ran({ stdoutBase64: b64('{"id":"x"}'), stderrBase64: b64('a note') }),
      );

      const result = await place().run(
        ['-J', '--', 'https://v.example/x'],
        90_000,
      );

      expect(result).toEqual({ stdout: '{"id":"x"}', stderr: 'a note' });
      expect(client.exec).toHaveBeenCalledTimes(1);
      const [sessionId, body] = client.exec.mock.calls[0] ?? [];
      expect(sessionId).toBe('vid-1');
      expect(body).toMatchObject({
        command: ['yt-dlp', '-J', '--', 'https://v.example/x'],
        cwd: '/agent/output',
        collectOutput: true,
        timeoutMs: 90_000,
      });
      expect(body.execId).toMatch(/^[0-9a-f-]{36}$/);
      // A signal of the run's own, and a listener on each of its streams.
      const [, , signal, callbacks] = client.exec.mock.calls[0] ?? [];
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(typeof callbacks.onStdout).toBe('function');
      expect(typeof callbacks.onStderr).toBe('function');
    });

    it('judges an exit that is not 0 by what yt-dlp said, as a run on this machine is judged', async () => {
      client.exec.mockResolvedValue(
        ran({
          status: 'failed',
          exitCode: 1,
          stderrBase64: b64(
            'ERROR: [youtube] x: Sign in to confirm you’re not a bot',
          ),
        }),
      );

      const error = await failure(place().run(['-J'], 90_000));

      expect(error.reason).toBe('botDetection');
      expect(error.message).toBe('yt-dlp exited 1 (reason: botDetection)');
    });

    it('tells a run stopped at its time limit apart', async () => {
      client.exec.mockResolvedValue(
        ran({ status: 'failed', exitCode: null, errorCode: 'TIMEOUT' }),
      );

      const error = await failure(place().run(['-J'], 90_000));

      expect(error.reason).toBe('timeout');
      expect(error.message).toBe('yt-dlp timed out after 90000ms');
    });

    it.each([
      [{ stdout: true, stderr: false }],
      [{ stdout: false, stderr: true }],
    ])(
      'takes no output the spawner cut short for whole: %j',
      async (truncated) => {
        client.exec.mockResolvedValue(
          ran({ stdoutBase64: b64('{"id":"x"'), truncated }),
        );

        const error = await failure(place().run(['-J'], 90_000));

        expect(error.reason).toBe('transient');
        expect(error.message).toBe(
          'yt-dlp output exceeded 5242880 bytes (cap-killed)',
        );
      },
    );

    it('names the image for a session that carries no yt-dlp', async () => {
      client.exec.mockResolvedValue(
        ran({
          status: 'failed',
          exitCode: null,
          errorCode: 'RUNTIME_ERROR',
          errorMessage: 'spawn failed: spawn yt-dlp ENOENT',
        }),
      );

      const error = await failure(place().run(['-J'], 90_000));

      expect(error.reason).toBe('binaryNotInstalled');
      expect(error.message).toBe(
        'yt-dlp could not be started in the sandbox session: spawn failed: spawn yt-dlp ENOENT. A sandbox runtime image of this release carries it.',
      );
    });

    it.each([
      ['RUNTIME_ERROR', 'spawn failed: spawn yt-dlp EACCES'],
      ['SESSION_OOM', 'the session ran out of memory'],
      ['SESSION_LOST', undefined],
      ['EXEC_STALLED', 'no output for 45 minutes'],
      ['CANCELLED', undefined],
    ])(
      'says nothing about the video when the session ended the run (%s)',
      async (errorCode, errorMessage) => {
        client.exec.mockResolvedValue(
          ran({
            status: 'failed',
            exitCode: null,
            errorCode,
            ...(errorMessage === undefined ? {} : { errorMessage }),
          }),
        );

        const error = await failure(place().run(['-J'], 90_000));

        // A temporary problem: the video's job comes back.
        expect(error.reason).toBe('transient');
        expect(error.message).toContain(
          errorCode === 'RUNTIME_ERROR' ? 'EACCES' : errorCode,
        );
      },
    );
  });

  describe('reaches what a session cannot', () => {
    const proxy = {
      url: 'socks5h://user-1:secret@residential.example:1080',
      pooled: null,
    };

    it("a proxy through the platform's relay, with a token for this job and that proxy", () => {
      const url = place().reach.proxyUrl?.(proxy) ?? '';

      expect(isRelayProxyUrl(url, KEY)).toBe(true);
      expect(url).not.toContain('residential');
      expect(url).not.toContain('secret');
      expect(verifyVideoRelayToken(new URL(url).password, KEY)).toMatchObject({
        use: 'proxy',
        job: 'job-1',
        proxy: videoProxyDigest(proxy.url),
      });
    });

    // Never the proxy's own address: that would put its credentials on a
    // command line in the session. A video that must go out through a proxy
    // then does not go out, and is not tried again for it.
    it.each([[{}], [{ WEBDAV_APP_PASSWORD_HMAC_KEY: 'too-short' }]])(
      'no proxy at all where no token can be signed (%j), and says which setting is missing',
      (env) => {
        let thrown: unknown;
        try {
          place(env).reach.proxyUrl?.(proxy);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(YtDlpError);
        const error = thrown as YtDlpError;
        expect(error.reason).toBe('jsRuntimeMissing');
        expect(error.message).toContain('WEBDAV_APP_PASSWORD_HMAC_KEY');
        expect(error.message).toContain('INSTANCE_SECRET');
        expect(error.message).not.toContain('secret@');
        expect(error.message).not.toContain('residential');
      },
    );

    it("the PO-token provider through the platform's relay, with the plugin its image carries", () => {
      const reach = place({ ...KEY, VIDEO_INGEST_POT_PROVIDER: 'true' }).reach;

      expect(reach.pluginDir).toBe('/opt/yt-dlp/plugins');
      expect(
        reach.potProviderUrl?.startsWith(
          `http://backend-api:3005${RELAY_POT_PATH}/v1.`,
        ),
      ).toBe(true);
      expect(
        verifyVideoRelayToken(
          reach.potProviderUrl?.split('/').at(-1) ?? '',
          KEY,
        ),
      ).toMatchObject({ use: 'pot', job: 'job-1' });
    });

    it('the provider a deployment names, through the relay all the same', () => {
      const reach = place({
        ...KEY,
        VIDEO_INGEST_POT_PROVIDER_URL: 'http://pot.internal:9000',
      }).reach;

      // Never the provider's own address: a session has no route to it.
      expect(reach.potProviderUrl).not.toContain('pot.internal');
      expect(reach.potProviderUrl).toContain(RELAY_POT_PATH);
      expect(reach.pluginDir).toBe('/opt/yt-dlp/plugins');
    });

    it('no provider and no plugin where the deployment runs none', () => {
      expect(place().reach).toMatchObject({
        potProviderUrl: null,
        pluginDir: null,
      });
    });
  });

  describe('holds the files of a run', () => {
    it('lists the files of its directory, each with its size', async () => {
      const entries: SessionFsEntry[] = [
        { name: 'media.webm', type: 'file', size: 9, mtimeMs: 1 },
        { name: 'sub', type: 'dir', size: 0, mtimeMs: 1 },
        { name: 'subs.en.vtt', type: 'file', size: 3, mtimeMs: 1 },
      ];
      client.list.mockResolvedValue(entries);

      expect(await place().list()).toEqual([
        { name: 'media.webm', size: 9 },
        { name: 'subs.en.vtt', size: 3 },
      ]);
      expect(client.list).toHaveBeenCalledWith('vid-1', '/agent/output');
    });

    // Every session has the directory: one that answers for none was lost,
    // which says nothing of what yt-dlp left. Read as an empty directory, a
    // lost session would be a video without sound, for good.
    it('tells a directory that is gone as a temporary problem', async () => {
      client.list.mockResolvedValue(null);

      const error = await failure(place().list());

      expect(error.reason).toBe('transient');
      expect(error.message).toBe(
        'the sandbox session no longer answers for its directory',
      );
    });

    it('reads a small file whole, under the limit its caller names', async () => {
      client.read.mockResolvedValue({
        bytes: new TextEncoder().encode('WEBVTT\n').buffer,
        contentType: 'application/octet-stream',
      });

      const bytes = await place().readFile('subs.en.vtt', 5 * 1024 * 1024);

      expect(Buffer.from(bytes).toString()).toBe('WEBVTT\n');
      expect(client.read).toHaveBeenCalledWith(
        'vid-1',
        '/agent/output/subs.en.vtt',
        { maxBytes: 5 * 1024 * 1024 },
      );
    });

    it('hands a file on as the stream the session sends, with its length', async () => {
      const body = new ReadableStream<Uint8Array>();
      client.open.mockResolvedValue({ body, size: 4_096 });

      const file = await place().openFile('media.webm', 100 * 1024 * 1024);

      expect(file).toEqual({ body, size: 4_096 });
      expect(client.open).toHaveBeenCalledWith(
        'vid-1',
        '/agent/output/media.webm',
        { maxBytes: 100 * 1024 * 1024 },
      );
    });

    it('fails a small file the session does not hand out by its own reason', async () => {
      client.read.mockResolvedValue(null);

      expect((await failure(place().readFile('subs.en.vtt', 10))).reason).toBe(
        'outputValidationFailed',
      );
    });

    // The file was listed, with its size, a moment before it is opened: a
    // session that no longer hands it out was lost since.
    it('tells a listed file the session no longer hands out as a temporary problem', async () => {
      client.open.mockResolvedValue(null);

      const error = await failure(place().openFile('media.webm', 100));

      expect(error.reason).toBe('transient');
      expect(error.message).toBe(
        'the sandbox session no longer hands out media.webm',
      );
    });

    // A session from before it refused a larger file itself declares the
    // length, and the reader turns it away: more than was measured, which
    // is yt-dlp's own doing and no retry's to mend.
    it('fails a file that declares more than its caller takes for good', async () => {
      client.open.mockRejectedValue(new client.TooLarge('too large'));

      const error = await failure(place().openFile('media.webm', 100));

      expect(error.reason).toBe('outputValidationFailed');
      expect(error.message).toBe(
        'the sandbox session holds more of media.webm than the 100 bytes it may be',
      );
    });

    it.each([
      ['listing what yt-dlp left', () => place().list(), 'list'],
      [
        'reading subs.en.vtt',
        () => place().readFile('subs.en.vtt', 10),
        'read',
      ],
      ['opening media.webm', () => place().openFile('media.webm', 10), 'open'],
      [
        'writing cookies.txt',
        () => place().writeFile('cookies.txt', 'x'),
        'stage',
      ],
    ] as const)(
      'tells a fault of the sandbox while %s as a temporary problem, in words of its own',
      async (doing, call, verb) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        client[verb].mockRejectedValue(
          new Error('sandbox spawner unreachable at http://sandbox:8003'),
        );

        const error = await failure(call());

        expect(error.reason).toBe('transient');
        expect(error.message).toBe(`the sandbox session failed while ${doing}`);
        expect(warn).toHaveBeenCalledWith(
          `[video_link] the sandbox session failed while ${doing}:`,
          'sandbox spawner unreachable at http://sandbox:8003',
        );
        warn.mockRestore();
      },
    );

    it.each(['../code/render.mjs', '/etc/passwd', 'a/b.webm', '.env', ''])(
      'asks the session for nothing under the name %j',
      async (name) => {
        expect((await failure(place().readFile(name, 10))).reason).toBe(
          'outputValidationFailed',
        );
        expect((await failure(place().openFile(name, 10))).reason).toBe(
          'outputValidationFailed',
        );
        expect((await failure(place().writeFile(name, 'x'))).reason).toBe(
          'outputValidationFailed',
        );
        expect(client.read).not.toHaveBeenCalled();
        expect(client.open).not.toHaveBeenCalled();
        expect(client.stage).not.toHaveBeenCalled();
      },
    );

    // A file the session skipped is not there, whatever the call said: a
    // run told to read it would go on without it and say nothing.
    it.each([
      [
        {
          staged: [],
          skipped: [{ path: 'output/cookies.txt', reason: 'too_large' }],
        },
        'the sandbox session did not take cookies.txt (too_large)',
      ],
      [
        { staged: [], skipped: [] },
        'the sandbox session did not take cookies.txt',
      ],
      [
        { staged: [{ path: 'output/other.txt', bytes: 8 }], skipped: [] },
        'the sandbox session did not take cookies.txt',
      ],
    ])('fails a file the session did not take: %j', async (answer, message) => {
      client.stage.mockResolvedValue(answer);

      const error = await failure(
        place().writeFile('cookies.txt', '# a jar\n'),
      );

      expect(error.reason).toBe('transient');
      expect(error.message).toBe(message);
    });

    it('stages a small file into its directory and answers where yt-dlp finds it', async () => {
      client.stage.mockResolvedValue({
        staged: [{ path: 'output/cookies.txt', bytes: 8 }],
        skipped: [],
      });

      const path = await place().writeFile('cookies.txt', '# a jar\n');

      expect(path).toBe('/agent/output/cookies.txt');
      expect(client.stage).toHaveBeenCalledWith('vid-1', [
        { path: 'output/cookies.txt', contentBase64: b64('# a jar\n') },
      ]);
    });

    it('leaves the session to whoever opened it', async () => {
      await place().dispose();

      for (const call of [
        client.exec,
        client.list,
        client.read,
        client.open,
        client.stage,
        client.session,
      ]) {
        expect(call).not.toHaveBeenCalled();
      }
    });
  });
});

describe('inYtdlpPlace — the place a video is fetched in, opened and closed', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the ctx is handed on to the session's opener, which is replaced here
  const ctx = { marker: 'ctx' } as never;
  const video = { organizationId: 'org-1', jobId: 'job-1', runKey: 'run-1' };

  it('opens a sandbox session for the video, and does the work in it [VID-R8]', async () => {
    delete process.env.VIDEO_INGEST_LANE;
    client.session.mockImplementation(
      (_ctx: unknown, _session: unknown, work: () => Promise<unknown>) =>
        work(),
    );
    client.list.mockResolvedValue([]);

    const dir = await inYtdlpPlace(ctx, video, async (opened) => {
      await opened.list();
      return opened.dir;
    });

    expect(dir).toBe('/agent/output');
    const [givenCtx, session] = client.session.mock.calls[0] ?? [];
    expect(givenCtx).toBe(ctx);
    expect(session).toMatchObject({
      organizationId: 'org-1',
      // The render budget's kind of session, released by the watchdog once
      // it is older than a job may run.
      ownerType: 'video',
      createdBy: 'system:video-links',
      idleTimeoutMs: 3 * 60_000,
      // One file of it may weigh what a video's sound may: a session's own
      // 100 MiB is two hours of sound served in fragments.
      maxFileBytes: MEDIA_MAX_BYTES,
      lane: 'video',
      unit: 'job',
    });
    expect(MEDIA_MAX_BYTES).toBe(1024 * 1024 * 1024);
    expect(session.sessionId).toMatch(/^vid-[0-9a-f]{16}$/);
    // The work ran in that session.
    expect(client.list).toHaveBeenCalledWith(
      session.sessionId,
      '/agent/output',
    );
  });

  describe("the deployment's own cookie jar", () => {
    const root = mkdtempSync(join(tmpdir(), 'tale-vlink-jar-'));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const saved = process.env.VIDEO_INGEST_COOKIES_FILE;
    afterEach(() => {
      if (saved === undefined) delete process.env.VIDEO_INGEST_COOKIES_FILE;
      else process.env.VIDEO_INGEST_COOKIES_FILE = saved;
    });
    const JAR =
      '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n';
    const inSession = () => {
      delete process.env.VIDEO_INGEST_LANE;
      client.session.mockImplementation(
        (_ctx: unknown, _session: unknown, work: () => Promise<unknown>) =>
          work(),
      );
      client.stage.mockImplementation(
        (_sessionId: unknown, files: { path: string }[]) =>
          Promise.resolve({
            staged: files.map((file) => ({ path: file.path, bytes: 1 })),
            skipped: [],
          }),
      );
    };
    /** The cookie flags a run in the opened place is given. */
    const cookieFlags = () =>
      inYtdlpPlace(ctx, video, (opened) =>
        Promise.resolve(
          cookiesFlagsFromEnv(process.env, undefined, opened.reach),
        ),
      );

    // The jar lies on this machine's disk, where a session reads nothing.
    it('is given to the session as a copy, and a run is told where the copy is', async () => {
      inSession();
      const path = join(root, 'jar.txt');
      writeFileSync(path, JAR);
      process.env.VIDEO_INGEST_COOKIES_FILE = ` ${path} `;

      expect(await cookieFlags()).toEqual([
        '--cookies',
        '/agent/output/deployment-cookies.txt',
      ]);
      const [sessionId, files] = client.stage.mock.calls[0] ?? [];
      expect(sessionId).toMatch(/^vid-[0-9a-f]{16}$/);
      expect(files).toEqual([
        { path: 'output/deployment-cookies.txt', contentBase64: b64(JAR) },
      ]);
      expect(client.stage).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, '', '   '])(
      'is not asked for where the deployment names none (%j), and nothing is said',
      async (value) => {
        inSession();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        if (value === undefined) delete process.env.VIDEO_INGEST_COOKIES_FILE;
        else process.env.VIDEO_INGEST_COOKIES_FILE = value;

        expect(await cookieFlags()).toEqual([]);
        expect(client.stage).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      },
    );

    it.each([
      ['is not there', () => join(root, 'no-such-jar.txt'), /ENOENT/],
      [
        'weighs more than a cookie jar may',
        () => {
          const path = join(root, 'huge.txt');
          writeFileSync(path, Buffer.alloc(1024 * 1024 + 1, 0x61));
          return path;
        },
        /it weighs 1048577 bytes, more than the 1048576 a cookie jar may/,
      ],
    ])(
      'leaves the video without it where it %s, and says why',
      async (_name, jar, why) => {
        inSession();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        process.env.VIDEO_INGEST_COOKIES_FILE = jar();

        // Never this machine's path: it names nothing in a session.
        expect(await cookieFlags()).toEqual([]);
        expect(client.stage).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain(
          'VIDEO_INGEST_COOKIES_FILE could not be given',
        );
        expect(String(warn.mock.calls[0]?.[1])).toMatch(why);
        warn.mockRestore();
      },
    );

    it('takes a jar of exactly what one may weigh', async () => {
      inSession();
      const path = join(root, 'full.txt');
      writeFileSync(path, Buffer.alloc(1024 * 1024, 0x61));
      process.env.VIDEO_INGEST_COOKIES_FILE = path;

      expect(await cookieFlags()).toEqual([
        '--cookies',
        '/agent/output/deployment-cookies.txt',
      ]);
    });

    it('leaves the video without it where the session would not take it', async () => {
      inSession();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      client.stage.mockRejectedValue(new Error('stage failed (502)'));
      const path = join(root, 'jar.txt');
      writeFileSync(path, JAR);
      process.env.VIDEO_INGEST_COOKIES_FILE = path;

      expect(await cookieFlags()).toEqual([]);
      // What the session said is the log's, and so is what came of it.
      expect(warn.mock.calls.map((call) => String(call[1]))).toEqual([
        'stage failed (502)',
        'the sandbox session failed while writing deployment-cookies.txt',
      ]);
      warn.mockRestore();
    });

    it('leaves the video without it where the session skipped it', async () => {
      inSession();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      client.stage.mockResolvedValue({
        staged: [],
        skipped: [
          { path: 'output/deployment-cookies.txt', reason: 'io_error' },
        ],
      });
      const path = join(root, 'jar.txt');
      writeFileSync(path, JAR);
      process.env.VIDEO_INGEST_COOKIES_FILE = path;

      expect(await cookieFlags()).toEqual([]);
      expect(String(warn.mock.calls[0]?.[1])).toBe(
        'the sandbox session did not take deployment-cookies.txt (io_error)',
      );
      warn.mockRestore();
    });

    it('is read where it lies by a run on this machine', async () => {
      process.env.VIDEO_INGEST_LANE = 'local';
      const path = join(root, 'jar.txt');
      writeFileSync(path, JAR);
      process.env.VIDEO_INGEST_COOKIES_FILE = path;

      expect(await cookieFlags()).toEqual(['--cookies', path]);
      expect(client.stage).not.toHaveBeenCalled();
    });
  });

  // A retry, and a job delivered twice, never meet what another run left.
  it('gives each run of a job a session of its own', async () => {
    delete process.env.VIDEO_INGEST_LANE;
    client.session.mockResolvedValue(undefined);

    await inYtdlpPlace(ctx, video, () => Promise.resolve());
    await inYtdlpPlace(ctx, { ...video, runKey: 'run-2' }, () =>
      Promise.resolve(),
    );
    await inYtdlpPlace(ctx, { ...video, jobId: 'job-2' }, () =>
      Promise.resolve(),
    );

    const ids = client.session.mock.calls.map((call) => call[1].sessionId);
    expect(new Set(ids).size).toBe(3);
  });

  // The sandbox host keeps a first-come line of the ids it refused. A run
  // that comes back from its wait under a new id stands behind its own
  // earlier asks, for as long as it waits.
  it('asks for the same session when a run comes back under its key', async () => {
    delete process.env.VIDEO_INGEST_LANE;
    client.session.mockResolvedValue(undefined);

    await inYtdlpPlace(ctx, video, () => Promise.resolve());
    await inYtdlpPlace(ctx, { ...video }, () => Promise.resolve());

    const ids = client.session.mock.calls.map((call) => call[1].sessionId);
    expect(ids[0]).toMatch(/^vid-[0-9a-f]{16}$/);
    expect(ids[1]).toBe(ids[0]);
  });

  it('hands on that there is no session to be had', async () => {
    delete process.env.VIDEO_INGEST_LANE;
    const none = new Error('the sandbox host is busy');
    client.session.mockRejectedValue(none);

    await expect(
      inYtdlpPlace(ctx, video, () => Promise.resolve('unreached')),
    ).rejects.toBe(none);
  });

  it('works in a directory of this machine where the lane is local, and removes it afterwards', async () => {
    process.env.VIDEO_INGEST_LANE = 'local';
    let dir = '';

    const answer = await inYtdlpPlace(ctx, video, async (opened) => {
      dir = opened.dir;
      await opened.writeFile('cookies.txt', 'a jar');
      expect(existsSync(dir)).toBe(true);
      return 'done';
    });

    expect(answer).toBe('done');
    expect(dir).toMatch(/vlink-[0-9a-f-]{36}$/);
    expect(existsSync(dir)).toBe(false);
    expect(client.session).not.toHaveBeenCalled();
  });

  it('removes the directory when the work fails, and tells its failure', async () => {
    process.env.VIDEO_INGEST_LANE = 'local';
    let dir = '';

    await expect(
      inYtdlpPlace(ctx, video, (opened) => {
        dir = opened.dir;
        return Promise.reject(new Error('the work failed'));
      }),
    ).rejects.toThrow('the work failed');
    expect(existsSync(dir)).toBe(false);
  });
});
