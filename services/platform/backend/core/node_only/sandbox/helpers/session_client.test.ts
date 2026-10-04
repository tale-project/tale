// Unit tests for the resilient exec drain (Stage 5). No spawner needed — global
// fetch is mocked to return SSE streams, including a mid-turn drop, and we
// assert the drain re-attaches via sinceSeq and feeds each delta exactly once.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  chunkStageFiles,
  drainSessionExecResilient,
  ExecStreamProtocolError,
  SandboxDeviceOfflineError,
  sandboxDeploymentLimits,
  sandboxDeviceDisconnect,
  sandboxDevices,
  STAGE_BODY_BUDGET_BYTES,
  SpawnerUnreachableError,
  sessionAcquire,
  sessionCancelExec,
  sessionCreate,
  SessionFileTooLargeError,
  sessionIsAlive,
  sessionDestroyWorkspace,
  sessionReadFile,
  sessionStageFiles,
  type SessionStageFile,
  SpawnerBusyError,
} from './session_client';

const enc = new TextEncoder();

/** A spawner 503 "draining" body — the bare `sandbox` alias is mid-flip. */
function drainingResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'draining',
      message: 'spawner is draining; retry shortly',
    }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );
}

/** A successful create body. */
function createdResponse(sessionId: string): Response {
  const session = {
    sessionId,
    organizationId: 'org-1',
    profile: 'agent',
    state: 'ready',
    backend: 'docker',
    createdAtMs: 1,
    expiresAtMs: 2,
    idleTimeoutMs: 1,
  };
  return new Response(JSON.stringify({ session }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build a Response whose body is an SSE stream of the given raw blocks. */
function sseResponse(blocks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const b of blocks) controller.enqueue(enc.encode(b));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const RESULT_OK = `event: result\ndata: ${JSON.stringify({
  status: 'completed',
  exitCode: 0,
  durationMs: 1,
  stdoutBase64: '',
  stderrBase64: '',
  truncated: { stdout: false, stderr: false },
})}\n\n`;

const origFetch = globalThis.fetch;
const origToken = process.env.SANDBOX_TOKEN;
const origUrl = process.env.SANDBOX_URL;
afterEach(() => {
  globalThis.fetch = origFetch;
  restoreEnv('SANDBOX_TOKEN', origToken);
  restoreEnv('SANDBOX_URL', origUrl);
});
beforeEach(() => {
  // Every spawner request is signed and the client refuses to send an
  // unsigned one, so the suite carries a secret like a real deployment.
  process.env.SANDBOX_TOKEN = 'test-sandbox-token';
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('drainSessionExecResilient', () => {
  test('reader admission keeps retrying the same attach beyond the transport failure budget', async () => {
    const requests: Array<{ url: string; method: string | undefined }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method });
      return requests.length <= 6
        ? sseResponse([
            'event: error\ndata: {"code":"ATTACH_BUSY","message":"busy"}\n\n',
          ])
        : sseResponse([RESULT_OK]);
    }) as typeof fetch;
    const result = await drainSessionExecResilient(
      's',
      { execId: 'e' },
      new AbortController().signal,
      {},
      { resumeSinceSeq: 3 },
    );
    expect(result.status).toBe('completed');
    expect(requests).toHaveLength(7);
    expect(
      requests.every(
        (request) =>
          request.method === 'GET' &&
          request.url.endsWith('/exec/e/attach?sinceSeq=3'),
      ),
    ).toBe(true);
  });

  test('cancellation ends reader admission retries without restarting the exec', async () => {
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      controller.abort();
      return sseResponse([
        'event: error\ndata: {"code":"ATTACH_BUSY","message":"busy"}\n\n',
      ]);
    }) as unknown as typeof fetch;
    await expect(
      drainSessionExecResilient(
        's',
        { execId: 'e' },
        controller.signal,
        {},
        { resumeSinceSeq: 3 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test.each([
    ['stdout', ''],
    ['stdout', '{"seq":3,"text":'],
    ['stderr', '{"seq":3}'],
    ['stdout', '{"seq":3,"text":42}'],
    ['stdout', '{"seq":"3","text":"lost cursor"}'],
    ['stdout', '{"seq":3,"b64":"not base64!"}'],
    ['result', '{}'],
    ['result', '{"status":"completed","exitCode":"0"}'],
    ['error', '{"code":42}'],
    ['gap', '{'],
    ['gap', '{}'],
    ['gap', '{"fromSeq":3,"toSeq":"9"}'],
    ['gap', '{"fromSeq":9,"toSeq":3}'],
    ['gap', '{"fromSeq":3,"toSeq":9007199254740992}'],
  ])(
    'refuses a corrupt %s payload before advancing the cursor: %s',
    async (event, data) => {
      let requests = 0;
      let cancelled = false;
      let stdout = '';
      let closeTimer: ReturnType<typeof setTimeout>;
      globalThis.fetch = (async () => {
        requests += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                enc.encode(
                  'event: stdout\ndata: {"seq":2,"text":"verified"}\n\n' +
                    `event: ${event}\ndata: ${data}\n\n` +
                    'event: stdout\ndata: {"seq":4,"text":"must not arrive"}\n\n' +
                    RESULT_OK,
                ),
              );
              // The refusal must release the transport before its natural end.
              closeTimer = setTimeout(() => controller.close(), 20);
            },
            cancel() {
              clearTimeout(closeTimer);
              cancelled = true;
            },
          }),
        );
      }) as unknown as typeof fetch;
      const cursor = { lastSeq: 0 };
      await expect(
        drainSessionExecResilient(
          's',
          { execId: 'e', command: ['fixture'] },
          AbortSignal.timeout(1000),
          {
            onStdout: (text) => {
              stdout += text;
            },
          },
          { cursor },
        ),
      ).rejects.toBeInstanceOf(ExecStreamProtocolError);
      expect(cursor.lastSeq).toBe(2);
      expect(stdout).toBe('verified');
      expect(requests).toBe(1);
      expect(cancelled).toBe(true);
    },
  );

  test('validates complete frames after JSON and base64 split across transport chunks', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'event: stdout\ndata: {"seq":2,"b64":"',
        '8J+Y',
        'gA==","futureField":true}\n',
        '\nevent: stderr\ndata: {"text":"legacy"}\n\n',
        RESULT_OK,
      ])) as unknown as typeof fetch;
    let stdout = '';
    let stderr = '';
    await drainSessionExecResilient(
      's',
      { execId: 'e', command: ['fixture'] },
      new AbortController().signal,
      {
        onStdout: (text) => {
          stdout += text;
        },
        onStderr: (text) => {
          stderr += text;
        },
      },
    );
    expect(stdout).toBe('😀');
    expect(stderr).toBe('legacy');
  });

  test('accepts SSE fields without spaces and joins data lines while ignoring keepalives', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        ': keepalive\n\n',
        'event:stdout\ndata:{"seq":2,\ndata:"text":"joined"}\n\n',
        RESULT_OK,
      ])) as unknown as typeof fetch;
    let stdout = '';
    await drainSessionExecResilient(
      's',
      { execId: 'e', command: ['fixture'] },
      new AbortController().signal,
      {
        onStdout: (text) => {
          stdout += text;
        },
      },
    );
    expect(stdout).toBe('joined');
  });

  test('does not announce replay completion from an invalid terminal result', async () => {
    globalThis.fetch = (async () =>
      sseResponse(['event: result\ndata: {}\n\n'])) as unknown as typeof fetch;
    let replayComplete = false;
    await expect(
      drainSessionExecResilient(
        's',
        { execId: 'e' },
        new AbortController().signal,
        {
          onReplayComplete: () => {
            replayComplete = true;
          },
        },
        { resumeSinceSeq: 0 },
      ),
    ).rejects.toBeInstanceOf(ExecStreamProtocolError);
    expect(replayComplete).toBe(false);
  });

  test.each([
    ['replay-start', '{'],
    ['replay-start', 'null'],
    ['replay-complete', '{'],
    ['replay-complete', '{}'],
    ['replay-complete', '{"throughSeq":"2"}'],
    ['replay-complete', '{"throughSeq":-1}'],
    ['replay-complete', '{"throughSeq":1.5}'],
  ])(
    'does not change replay state from an invalid %s marker: %s',
    async (event, data) => {
      let requests = 0;
      const phases: string[] = [];
      globalThis.fetch = (async () => {
        requests += 1;
        return sseResponse([
          `event: ${event}\ndata: ${data}\n\n`,
          'event: stdout\ndata: {"seq":2,"text":"must not arrive"}\n\n',
          RESULT_OK,
        ]);
      }) as unknown as typeof fetch;
      await expect(
        drainSessionExecResilient(
          's',
          { execId: 'e' },
          new AbortController().signal,
          {
            onReplayStarted: () => {
              phases.push('started');
            },
            onReplayComplete: () => {
              phases.push('complete');
            },
            onStdout: (text) => {
              phases.push(text);
            },
          },
          { resumeSinceSeq: 0 },
        ),
      ).rejects.toBeInstanceOf(ExecStreamProtocolError);
      expect(phases).toEqual(['started']);
      expect(requests).toBe(1);
    },
  );

  test('preserves stdout and completion at every CRLF chunk boundary', async () => {
    const frame =
      'event: stdout\r\ndata: {"seq":2,"text":"REQUIRED OUTPUT"}\r\n\r\n';
    for (let split = 1; split < frame.length; split += 1) {
      globalThis.fetch = (async () =>
        sseResponse([
          frame.slice(0, split),
          frame.slice(split),
          RESULT_OK,
        ])) as unknown as typeof fetch;
      let text = '';
      const cursor = { lastSeq: 0 };
      const result = await drainSessionExecResilient(
        's',
        { execId: 'e' },
        new AbortController().signal,
        {
          onStdout: (chunk) => {
            text += chunk;
          },
        },
        { cursor },
      );
      expect({
        split,
        text,
        seq: cursor.lastSeq,
        status: result.status,
      }).toEqual({
        split,
        text: 'REQUIRED OUTPUT',
        seq: 2,
        status: 'completed',
      });
    }
  });

  test('scans fragmented SSE input in linear work instead of rescanning its buffered prefix', async () => {
    const text = 'x'.repeat(1024 * 1024);
    const frame = `event: stdout\ndata: ${JSON.stringify({ seq: 2, text })}\n\n`;
    const chunks: string[] = [];
    for (let at = 0; at < frame.length; at += 4096) {
      chunks.push(frame.slice(at, at + 4096));
    }
    globalThis.fetch = (async () =>
      sseResponse([...chunks, RESULT_OK])) as unknown as typeof fetch;
    // Saved for the instrumentation below, which supplies its receiver with call.
    // oxlint-disable-next-line typescript/unbound-method
    const originalIndexOf = String.prototype.indexOf;
    let searchedChars = 0;
    const spy = vi
      .spyOn(String.prototype, 'indexOf')
      .mockImplementation(function (this: string, search: string, start = 0) {
        const found = originalIndexOf.call(this, search, start);
        if (search === '\n' || search === '\r' || search === '\n\n') {
          searchedChars +=
            (found < 0 ? this.length : found + search.length) - start;
        }
        return found;
      });
    let output = '';
    try {
      await drainSessionExecResilient(
        's',
        { execId: 'e' },
        new AbortController().signal,
        {
          onStdout: (chunk) => {
            output += chunk;
          },
        },
      );
    } finally {
      spy.mockRestore();
    }
    expect(output).toBe(text);
    // Counts characters examined by delimiter searches, not noisy elapsed
    // time. Whole-prefix rescans examine over128x the input for this fixture.
    expect(searchedChars).toBeLessThan(frame.length * 8);
  });

  test.each(['complete', 'fragmented', 'comment', 'multiline'] as const)(
    'refuses an oversized %s SSE frame and cancels without reconnecting',
    async (shape) => {
      const maxChars = 16 * 1024 * 1024;
      const frame =
        shape === 'comment'
          ? `: ${'x'.repeat(maxChars)}\n\n`
          : shape === 'multiline'
            ? `event: stdout\n${`data: ${'x'.repeat(4096)}\n`.repeat(4096)}\n`
            : `event: stdout\ndata: ${JSON.stringify({ seq: 2, text: 'x'.repeat(maxChars) })}\n\n`;
      const chunkSize = shape === 'complete' ? frame.length : 64 * 1024;
      let at = 0;
      let cancelled = false;
      let requests = 0;
      globalThis.fetch = (async () => {
        requests += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (at < frame.length) {
                controller.enqueue(enc.encode(frame.slice(at, at + chunkSize)));
                at += chunkSize;
              }
            },
            cancel() {
              cancelled = true;
            },
          }),
        );
      }) as unknown as typeof fetch;
      const cursor = { lastSeq: 0 };
      const onStdout = vi.fn();
      await expect(
        drainSessionExecResilient(
          's',
          { execId: 'e' },
          new AbortController().signal,
          { onStdout },
          { cursor },
        ),
      ).rejects.toThrow('Sandbox SSE frame exceeds 16 MiB');
      expect(cancelled).toBe(true);
      expect(requests).toBe(1);
      expect(cursor.lastSeq).toBe(0);
      expect(onStdout).not.toHaveBeenCalled();
    },
  );

  test('resets the frame budget between events in a large network chunk', async () => {
    const value = 'x'.repeat(8 * 1024 * 1024);
    const frame = (seq: number) =>
      `event: stdout\ndata: ${JSON.stringify({ seq, text: value })}\n\n`;
    globalThis.fetch = (async () =>
      sseResponse([
        frame(2) + frame(3) + RESULT_OK,
      ])) as unknown as typeof fetch;
    let chars = 0;
    await drainSessionExecResilient(
      's',
      { execId: 'e' },
      new AbortController().signal,
      {
        onStdout: (text) => {
          chars += text.length;
        },
      },
    );
    expect(chars).toBe(value.length * 2);
  });

  test('discards an incomplete event at EOF before replaying it once', async () => {
    const frame = 'event: stdout\ndata: {"seq":2,"text":"once"}\n\n';
    let requests = 0;
    const cursor = { lastSeq: 0 };
    globalThis.fetch = (async () => {
      requests += 1;
      // A single newline has finished the data line, but has not dispatched
      // the event. Reconnect must neither emit it nor advance its cursor.
      if (requests === 1) return sseResponse([frame.slice(0, -1)]);
      expect(cursor.lastSeq).toBe(0);
      return sseResponse([frame, RESULT_OK]);
    }) as unknown as typeof fetch;
    const received: string[] = [];
    await drainSessionExecResilient(
      's',
      { execId: 'e' },
      new AbortController().signal,
      {
        onStdout: (text) => {
          received.push(text);
        },
      },
      { cursor },
    );
    expect(received).toEqual(['once']);
    expect(requests).toBe(2);
    expect(cursor.lastSeq).toBe(2);
  });

  test('accepts standard multiline data and CR-only event boundaries', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'event:stdout\rdata:{"seq":2,\rdata:"text":"joined"}\r\r',
        RESULT_OK,
      ])) as unknown as typeof fetch;
    const received: string[] = [];
    await drainSessionExecResilient(
      's',
      { execId: 'e' },
      new AbortController().signal,
      {
        onStdout: (text) => {
          received.push(text);
        },
      },
    );
    expect(received).toEqual(['joined']);
  });

  test.each(['aG!!!k=', 'aGk', 'aGk=\n', 'aGl=', 123, null])(
    'rejects corrupt raw output without advancing the cursor or retrying (%j)',
    async (b64) => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return sseResponse([
          `event: stdout\ndata: ${JSON.stringify({ seq: 2, b64, text: 'untrusted fallback' })}\n\n`,
          RESULT_OK,
        ]);
      }) as unknown as typeof fetch;
      const cursor = { lastSeq: 0 };
      let text = '';
      await expect(
        drainSessionExecResilient(
          's',
          { execId: 'e' },
          new AbortController().signal,
          {
            onStdout: (chunk) => {
              text += chunk;
            },
          },
          { cursor },
        ),
      ).rejects.toBeInstanceOf(ExecStreamProtocolError);
      expect(cursor.lastSeq).toBe(0);
      expect(text).toBe('');
      expect(calls).toBe(1);
    },
  );

  test('keeps invalid raw output fatal when replay completion aborts the drain', async () => {
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return sseResponse([
        'event: replay-complete\ndata: {"throughSeq":0}\n\n',
        'event: stdout\ndata: {"seq":2,"b64":"aG!!!k="}\n\n',
        RESULT_OK,
      ]);
    }) as unknown as typeof fetch;
    const cursor = { lastSeq: 0 };
    await expect(
      drainSessionExecResilient(
        's',
        { execId: 'e' },
        controller.signal,
        { onReplayComplete: () => controller.abort() },
        { cursor, resumeSinceSeq: 0 },
      ),
    ).rejects.toBeInstanceOf(ExecStreamProtocolError);
    expect(controller.signal.aborted).toBe(true);
    expect(cursor.lastSeq).toBe(0);
    expect(calls).toBe(1);
  });

  test('does not announce replay completion from noncanonical base64 output', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return sseResponse([
        'event: stdout\ndata: {"seq":2,"b64":"aGl="}\n\n',
        RESULT_OK,
      ]);
    }) as unknown as typeof fetch;
    const cursor = { lastSeq: 0 };
    const phases: string[] = [];
    await expect(
      drainSessionExecResilient(
        's',
        { execId: 'e' },
        new AbortController().signal,
        {
          onReplayStarted: () => {
            phases.push('started');
          },
          onReplayComplete: () => {
            phases.push('complete');
          },
          onStdout: (text) => {
            phases.push(text);
          },
        },
        { cursor, resumeSinceSeq: 0 },
      ),
    ).rejects.toBeInstanceOf(ExecStreamProtocolError);
    expect(phases).toEqual(['started']);
    expect(cursor.lastSeq).toBe(0);
    expect(requests).toBe(1);
  });

  test('enables contiguous legacy replay without waiting for a marker', async () => {
    const phases: string[] = [];
    globalThis.fetch = (async () =>
      sseResponse([
        'event: phase\ndata: {"phase":"running"}\n\n',
        'event: stdout\ndata: {"seq":2,"text":"legacy"}\n\n',
        RESULT_OK,
      ])) as unknown as typeof fetch;
    await drainSessionExecResilient(
      's',
      { execId: 'e' },
      new AbortController().signal,
      {
        onReplayStarted: () => {
          phases.push('start');
        },
        onReplayComplete: () => {
          phases.push('complete');
        },
        onStdout: (text) => {
          phases.push(text);
        },
      },
      { resumeSinceSeq: 0 },
    );
    expect(phases).toEqual(['start', 'complete', 'legacy']);
  });

  test('keeps journal history gated until its explicit completion marker', async () => {
    const phases: string[] = [];
    globalThis.fetch = (async () =>
      sseResponse([
        'event: replay-start\ndata: {}\n\n',
        'event: stdout\ndata: {"seq":2,"text":"history"}\n\n',
        'event: replay-complete\ndata: {"throughSeq":2}\n\n',
        RESULT_OK,
      ])) as unknown as typeof fetch;
    await drainSessionExecResilient(
      's',
      { execId: 'e' },
      new AbortController().signal,
      {
        onReplayStarted: () => {
          phases.push('start');
        },
        onReplayComplete: () => {
          phases.push('complete');
        },
        onStdout: (text) => {
          phases.push(text);
        },
      },
      { resumeSinceSeq: 0 },
    );
    expect(phases).toEqual(['start', 'history', 'complete']);
  });

  test('fails a legacy ring rollover before consuming its partial history', async () => {
    let calls = 0;
    let text = '';
    globalThis.fetch = (async () => {
      calls += 1;
      return sseResponse([
        'event: stdout\ndata: {"seq":40,"text":"incomplete"}\n\n',
        RESULT_OK,
      ]);
    }) as unknown as typeof fetch;
    await expect(
      drainSessionExecResilient(
        's',
        { execId: 'e' },
        new AbortController().signal,
        {
          onStdout: (chunk) => {
            text += chunk;
          },
        },
        { resumeSinceSeq: 0 },
      ),
    ).rejects.toThrow('Legacy sandbox replay is incomplete');
    expect(calls).toBe(1);
    expect(text).toBe('');
  });

  test('decodes exact UTF-8 bytes across stdout/stderr frames and reconnects without duplicates', async () => {
    const stdout = Buffer.from('A😀Z');
    const stderr = Buffer.from('é');
    const frame = (event: string, seq: number, bytes: Uint8Array) =>
      `event: ${event}\ndata: ${JSON.stringify({ seq, b64: Buffer.from(bytes).toString('base64'), text: 'legacy replacement' })}\n\n`;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? sseResponse([
            frame('stdout', 2, stdout.subarray(0, 3)),
            frame('stderr', 3, stderr.subarray(0, 1)),
          ])
        : sseResponse([
            frame('stdout', 2, stdout.subarray(0, 3)),
            frame('stderr', 4, stderr.subarray(1)),
            frame('stdout', 5, stdout.subarray(3)),
            RESULT_OK,
          ]);
    }) as unknown as typeof fetch;
    let out = '';
    let err = '';
    const cursor = { lastSeq: 0 };
    await drainSessionExecResilient(
      's',
      { execId: 'e', command: ['fixture'] },
      new AbortController().signal,
      {
        onStdout: (chunk) => {
          out += chunk;
        },
        onStderr: (chunk) => {
          err += chunk;
        },
      },
      { cursor },
    );
    expect(out).toBe('A😀Z');
    expect(err).toBe('é');
    expect(cursor.lastSeq).toBe(5);
    expect(calls).toBe(2);
  });

  test('flushes a final incomplete UTF-8 character only at authoritative EOF', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'event: stdout\ndata: {"seq":2,"b64":"ww=="}\n\n',
        RESULT_OK,
      ])) as unknown as typeof fetch;
    let text = '';
    await drainSessionExecResilient(
      's',
      { execId: 'e', command: ['fixture'] },
      new AbortController().signal,
      {
        onStdout: (chunk) => {
          text += chunk;
        },
      },
    );
    expect(text).toBe('�');
  });

  test('marks replay boundaries and fails a journal gap without reconnecting', async () => {
    let requests = 0;
    const phases: string[] = [];
    globalThis.fetch = (async () => {
      requests += 1;
      return sseResponse([
        'event: replay-complete\ndata: {"throughSeq":2}\n\n',
        'event: error\ndata: {"code":"REPLAY_GAP","message":"replay unavailable"}\n\n',
      ]);
    }) as unknown as typeof fetch;
    await expect(
      drainSessionExecResilient(
        's',
        { execId: 'e' },
        new AbortController().signal,
        {
          onReplayStarted: () => {
            phases.push('started');
          },
          onReplayComplete: () => {
            phases.push('complete');
          },
        },
        { resumeSinceSeq: 0 },
      ),
    ).rejects.toBeInstanceOf(ExecStreamProtocolError);
    expect(phases).toEqual(['started', 'complete']);
    expect(requests).toBe(1);
  });

  test('does not advance past a refused harness record and cancels its reader', async () => {
    let cancelled = false;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              enc.encode(
                'event: stdout\ndata: {"text":"oversized record","seq":2}\n\n',
              ),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    }) as unknown as typeof fetch;
    const cursor = { lastSeq: 0 };
    let checkpointSeq: number | undefined;
    await expect(
      drainSessionExecResilient(
        's',
        { execId: 'e' },
        new AbortController().signal,
        {
          onStdout: () => {
            checkpointSeq = cursor.lastSeq;
            throw new Error('protocol record exceeds budget');
          },
        },
        { cursor },
      ),
    ).rejects.toThrow('protocol record exceeds budget');
    expect(checkpointSeq).toBe(2);
    expect(cursor.lastSeq).toBe(0);
    expect(cancelled).toBe(true);
    expect(requests).toBe(1);
  });
  test('re-attaches after a mid-turn drop and feeds each delta once', async () => {
    const calls: string[] = [];
    let n = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url));
      n += 1;
      if (n === 1) {
        // Initial exec: a phase + one stdout delta (seq 2), then the stream
        // ends WITHOUT a terminal result → a non-terminal drop.
        return sseResponse([
          `event: phase\ndata: {"phase":"running","seq":1}\n\n`,
          `event: stdout\ndata: {"text":"AB","seq":2}\n\n`,
        ]);
      }
      // Re-attach: the next delta (seq 3) + the terminal result.
      return sseResponse([
        `event: stdout\ndata: {"text":"CD","seq":3}\n\n`,
        RESULT_OK,
      ]);
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    const stdout: string[] = [];
    const result = await drainSessionExecResilient(
      'ses-1',
      { execId: 'exec-1', command: ['x'], timeoutMs: 1_000 },
      new AbortController().signal,
      { onStdout: (t) => stdout.push(t) },
    );

    expect(result.status).toBe('completed');
    // Each delta delivered exactly once, in order (no dup from replay).
    expect(stdout).toEqual(['AB', 'CD']);
    // Second call was the attach with the resume cursor at seq 2.
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain('/attach');
    expect(calls[1]).toContain('sinceSeq=2');
  });

  test('gives up after the max consecutive reconnect failures', async () => {
    let n = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      n += 1;
      // Always drop with no progress (no seq'd delta) → consecutive failures.
      return sseResponse([`event: phase\ndata: {"phase":"running"}\n\n`]);
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    await expect(
      drainSessionExecResilient(
        'ses-2',
        { execId: 'exec-2', command: ['x'], timeoutMs: 1_000 },
        new AbortController().signal,
        {},
      ),
    ).rejects.toThrow();
    // 1 initial + MAX_RECONNECT_ATTEMPTS (5) re-attaches before throwing.
    expect(n).toBe(6);
    // Longer timeout: the give-up path deliberately sleeps the full linear
    // backoff (0.5+1+1.5+2+2.5s ≈ 7.5s) across the 5 retries.
  }, 15_000);
});

describe('drainSessionExecResilient — a lost first POST', () => {
  // Regression: every retry used to ATTACH. When the initial exec POST never
  // reached the spawner (network drop, 503 mid-roll), the exec did not exist,
  // so each attach answered `exec <id> not found` and the whole budget burned
  // against a healthy session.
  test('re-creates the exec when the spawner answers not-found with nothing consumed', async () => {
    const calls: { url: string; method: string }[] = [];
    let n = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({
        url: String(url),
        // oxlint-disable-next-line typescript-eslint/no-unsafe-member-access
        method: String(init?.method ?? 'GET'),
      });
      n += 1;
      // The POST is lost before any response.
      if (n === 1) throw new TypeError('fetch failed');
      if (String(url).includes('/attach')) {
        return sseResponse([
          `event: error\ndata: ${JSON.stringify({ message: 'exec exec-3 not found' })}\n\n`,
        ]);
      }
      return sseResponse([
        `event: stdout\ndata: {"text":"OK","seq":1}\n\n`,
        RESULT_OK,
      ]);
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    const stdout: string[] = [];
    const result = await drainSessionExecResilient(
      'ses-3',
      { execId: 'exec-3', command: ['x'], timeoutMs: 1_000 },
      new AbortController().signal,
      { onStdout: (t) => stdout.push(t) },
    );

    expect(result.status).toBe('completed');
    expect(stdout).toEqual(['OK']);
    // POST (lost) → attach (not found) → POST again (created) — not a fifth
    // identical attach.
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'POST']);
    expect(calls[1]?.url).toContain('/attach');
    expect(calls[2]?.url).not.toContain('/attach');
  }, 15_000);

  test('never re-creates an exec that already produced output', async () => {
    const methods: string[] = [];
    let n = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async (_url: any, init?: any) => {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-member-access
      methods.push(String(init?.method ?? 'GET'));
      n += 1;
      // Progress (seq 2), then the stream drops without a result…
      if (n === 1) {
        return sseResponse([`event: stdout\ndata: {"text":"AB","seq":2}\n\n`]);
      }
      // …and the spawner has since lost the exec. Re-POSTing here would run
      // the turn twice; the drain must fail instead.
      return sseResponse([
        `event: error\ndata: ${JSON.stringify({ message: 'exec exec-4 not found' })}\n\n`,
      ]);
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    await expect(
      drainSessionExecResilient(
        'ses-4',
        { execId: 'exec-4', command: ['x'], timeoutMs: 1_000 },
        new AbortController().signal,
        {},
      ),
    ).rejects.toThrow(/not found/);
    expect(methods.filter((m) => m === 'POST')).toHaveLength(1);
  }, 15_000);
});

describe('chunkStageFiles', () => {
  const stageFile = (path: string, contentBytes: number): SessionStageFile => ({
    path,
    contentBase64: 'a'.repeat(contentBytes),
  });

  test('packs many files into batches whose serialized body stays under the budget', () => {
    const budget = 1_000;
    const files = Array.from({ length: 40 }, (_, i) =>
      stageFile(`dir/file-${i}.txt`, 100),
    );
    const batches = chunkStageFiles(files, budget);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(
        Buffer.byteLength(JSON.stringify({ files: batch }), 'utf8'),
      ).toBeLessThanOrEqual(budget);
    }
    // Order and completeness: flattening the batches reproduces the input.
    expect(batches.flat()).toEqual(files);
  });

  test('a single entry over the budget throws instead of 413ing downstream', () => {
    expect(() => chunkStageFiles([stageFile('big.bin', 2_000)], 1_000)).toThrow(
      /big\.bin/,
    );
  });

  test('empty input yields no batches', () => {
    expect(chunkStageFiles([], 1_000)).toEqual([]);
  });
});

describe('sessionStageFiles chunking', () => {
  test('splits an over-budget payload into sequential POSTs and merges results', async () => {
    // Two files that cannot share one batch under the module budget: each
    // serializes to ~0.9 MiB, together ~1.8 MiB > 1.5 MiB.
    const big = Math.floor(STAGE_BODY_BUDGET_BYTES * 0.6);
    const files: SessionStageFile[] = [
      { path: 'skills/a/SKILL.md', contentBase64: 'a'.repeat(big) },
      { path: 'skills/b/SKILL.md', contentBase64: 'b'.repeat(big) },
    ];
    const bodies: Array<{ files: SessionStageFile[] }> = [];
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async (_url: any, init: any) => {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const body = JSON.parse(String(init.body)) as {
        files: SessionStageFile[];
      };
      bodies.push(body);
      return new Response(
        JSON.stringify({
          staged: body.files.map((f) => ({ path: f.path, bytes: 1 })),
          skipped:
            bodies.length === 2
              ? [{ path: 'skills/b/extra', reason: 'denied' }]
              : [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    const result = await sessionStageFiles('ses-stage', files);
    expect(bodies.length).toBe(2);
    expect(bodies[0]?.files.map((f) => f.path)).toEqual(['skills/a/SKILL.md']);
    expect(bodies[1]?.files.map((f) => f.path)).toEqual(['skills/b/SKILL.md']);
    expect(result.staged.map((s) => s.path)).toEqual([
      'skills/a/SKILL.md',
      'skills/b/SKILL.md',
    ]);
    expect(result.skipped).toEqual([
      { path: 'skills/b/extra', reason: 'denied' },
    ]);
  });
});

describe('sessionCreate drain-retry', () => {
  test('retries past a 503 draining and creates once the spawner is back', async () => {
    let n = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      n += 1;
      // First attempt hits the spawner mid in-place restart (draining); the
      // re-POST lands once it is back up.
      return n === 1 ? drainingResponse() : createdResponse('ses-x');
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    const result = await sessionCreate({
      sessionId: 'ses-x',
      organizationId: 'org-1',
      profile: 'agent',
    });

    expect(n).toBe(2);
    expect(result.session.sessionId).toBe('ses-x');
  });

  test('gives up after the max drain retries', async () => {
    let n = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      n += 1;
      return drainingResponse();
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    await expect(
      sessionCreate({
        sessionId: 'ses-y',
        organizationId: 'org-1',
        profile: 'agent',
      }),
    ).rejects.toThrow(/draining/);
    // 1 initial + CREATE_DRAIN_RETRY_MAX (5) retries; the 6th attempt has
    // attempt === MAX, so it falls through to the generic 503 failure.
    expect(n).toBe(6);
    // The give-up path sleeps 5 × 400ms ≈ 2s across the retries.
  }, 10_000);
});

describe('sessionCreate at host capacity', () => {
  function refuse(body: string, retryAfter?: string): void {
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () =>
      new Response(body, {
        status: 429,
        headers: {
          'content-type': 'application/json',
          ...(retryAfter !== undefined ? { 'retry-after': retryAfter } : {}),
        },
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
      })) as any;
  }
  const create = () =>
    sessionCreate({
      sessionId: 'ses-busy',
      organizationId: 'org-1',
      profile: 'agent',
    }).catch((error: unknown) => error);

  test("carries the create's place in the spawner's line with its hint", async () => {
    refuse(
      JSON.stringify({
        error: 'host_memory',
        message: 'the sandbox host is short of memory',
        queue: { position: 3, waiting: 7 },
      }),
      '42',
    );
    const error = await create();
    expect(error).toBeInstanceOf(SpawnerBusyError);
    expect(error instanceof SpawnerBusyError && error.retryAfterMs).toBe(
      42_000,
    );
    expect(error instanceof SpawnerBusyError && error.queue).toEqual({
      position: 3,
      waiting: 7,
    });
  });

  test('names no place for a spawner that keeps no line', async () => {
    for (const body of [
      JSON.stringify({ error: 'session_quota', message: 'cap reached' }),
      JSON.stringify({ error: 'busy', queue: { position: 'next' } }),
      'Too Many Requests',
      '',
    ]) {
      refuse(body, '10');
      const error = await create();
      expect(error).toBeInstanceOf(SpawnerBusyError);
      expect(error instanceof SpawnerBusyError && error.retryAfterMs).toBe(
        10_000,
      );
      expect(error instanceof SpawnerBusyError && error.queue).toBeUndefined();
    }
  });
});

/** The hub's answer for a session whose device is not connected. */
function deviceOfflineResponse(deviceId: string): Response {
  return new Response(
    JSON.stringify({ error: 'device_offline', deviceId, message: 'offline' }),
    {
      status: 503,
      headers: {
        'content-type': 'application/json',
        'x-tale-sandbox-device': deviceId,
      },
    },
  );
}

describe('sessionDestroyWorkspace', () => {
  const urls: string[] = [];
  function answer(body: unknown) {
    urls.length = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;
  }

  test('asks the spawner to await the deletion, under each condition', async () => {
    answer({ destroyed: true, busy: false, deletion: 'done' });
    await sessionDestroyWorkspace('pa-1', { ifIdle: true, ifStopped: true });
    await sessionDestroyWorkspace('pa-1', { ifIdle: true });
    await sessionDestroyWorkspace('pa-1');
    expect(urls.map((url) => new URL(url).search)).toEqual([
      '?if_idle=1&if_stopped=1&await_deletion=1',
      '?if_idle=1&await_deletion=1',
      '?await_deletion=1',
    ]);
  });

  test('answers how far the deletion came, and nothing from a spawner that predates it', async () => {
    answer({ destroyed: true, busy: false, deletion: 'pending' });
    expect(await sessionDestroyWorkspace('pa-1')).toEqual({
      destroyed: true,
      busy: false,
      deletion: 'pending',
    });
    answer({ destroyed: true, busy: false, deletion: 'handed_off' });
    expect(await sessionDestroyWorkspace('pa-1')).toMatchObject({
      deletion: 'handed_off',
    });
    // A spawner older than the contract: no state, which the cleanup reads
    // as unconfirmed, never as done.
    answer({ destroyed: true, busy: false });
    expect(await sessionDestroyWorkspace('pa-1')).toEqual({
      destroyed: true,
      busy: false,
    });
  });
});

describe('sessions on connected devices', () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  function answer(res: () => Response) {
    calls.length = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return res();
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;
  }

  test('a create carries its placement hint to the hub', async () => {
    answer(() => createdResponse('pa-1'));
    await sessionCreate({
      sessionId: 'pa-1',
      organizationId: 'org-1',
      profile: 'agent',
      placement: 'device',
    });
    const body = calls[0]?.init?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toMatchObject({
      placement: 'device',
    });
  });

  test('an offline device is its own error — never retried, never "gone"', async () => {
    answer(() => deviceOfflineResponse('dev-9'));
    const error = await sessionCreate({
      sessionId: 'pa-2',
      organizationId: 'org-1',
      profile: 'agent',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SandboxDeviceOfflineError);
    expect(error instanceof SandboxDeviceOfflineError && error.deviceId).toBe(
      'dev-9',
    );
    expect(calls).toHaveLength(1);
    // The liveness probe must not read the 503 as "session gone" (false).
    await expect(sessionIsAlive('pa-2')).rejects.toBeInstanceOf(
      SandboxDeviceOfflineError,
    );
    await expect(sessionAcquire('pa-2')).rejects.toBeInstanceOf(
      SandboxDeviceOfflineError,
    );
  });

  test("the limits read asks for the organization's device slots", async () => {
    answer(() => Response.json({ maxSessions: 8, deviceSessions: 4 }));
    expect(await sandboxDeploymentLimits('org-1')).toEqual({
      maxSessions: 8,
      deviceSessions: 4,
    });
    expect(calls[0]?.url).toMatch(/\/v1\/limits\?organizationId=org-1$/);
  });

  test('device list and disconnect; an older spawner has no devices', async () => {
    answer(() =>
      Response.json({
        hub: true,
        devices: [
          {
            deviceId: 'dev-1',
            connectedAtMs: 1,
            version: '0.5.60',
            compatible: true,
            maxSessions: 2,
            sessions: { running: 0, starting: 0 },
            resources: null,
            platform: { os: 'linux', arch: 'x64' },
            update: {
              state: 'idle',
              targetVersion: null,
              error: null,
              atMs: null,
            },
          },
        ],
      }),
    );
    expect((await sandboxDevices('org-1')).devices[0]?.deviceId).toBe('dev-1');
    answer(() => new Response('{"error":"not_found"}', { status: 404 }));
    expect(await sandboxDevices('org-1')).toEqual({ hub: false, devices: [] });
    expect(await sandboxDeviceDisconnect('dev-1')).toEqual({
      disconnected: false,
      placementsDropped: 0,
    });
    answer(() => Response.json({ disconnected: true, placementsDropped: 3 }));
    expect(await sandboxDeviceDisconnect('dev-1')).toEqual({
      disconnected: true,
      placementsDropped: 3,
    });
    expect(calls[0]?.url).toMatch(/\/v1\/devices\/dev-1\/disconnect$/);
    expect(calls[0]?.init?.method).toBe('POST');
  });
});

describe('spawner call preconditions', () => {
  test('an unreachable spawner names the target, the call and the syscall', async () => {
    process.env.SANDBOX_URL = 'http://sandbox:8003';
    // What Bun/undici throws when the request never completed: a TypeError
    // whose own cause carries the syscall — the whole diagnosis.
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('getaddrinfo EAI_AGAIN sandbox'),
      });
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    const err = await sessionIsAlive('ses-dead').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SpawnerUnreachableError);
    const message = err instanceof Error ? err.message : String(err);
    expect(message).toContain('http://sandbox:8003');
    expect(message).toContain('GET /v1/sessions/ses-dead');
    expect(message).toContain('getaddrinfo EAI_AGAIN sandbox');
    expect(message).toContain('SANDBOX_URL');
  });

  test('a deliberate abort passes through, unwrapped', async () => {
    // The turn-ended cut and every caller signal abort in-flight requests,
    // and the resilient drain branches on the rejection — reporting one as an
    // unreachable spawner would read as a dead sandbox and fail the turn.
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    const err = await sessionIsAlive('ses-cut').catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(SpawnerUnreachableError);
    expect(err instanceof Error ? err.name : '').toBe('AbortError');
  });

  test('credentials in SANDBOX_URL never reach the error message', async () => {
    // The message is what lands in the error tracker.
    process.env.SANDBOX_URL = 'http://ops:s3cret@sandbox:8003';
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    const err = await sessionIsAlive('ses-secret').catch((e: unknown) => e);

    const message = err instanceof Error ? err.message : String(err);
    expect(message).toContain('sandbox:8003');
    expect(message).not.toContain('s3cret');
    expect(message).not.toContain('ops:');
  });

  test('a missing SANDBOX_TOKEN fails before any request goes out', async () => {
    delete process.env.SANDBOX_TOKEN;
    let calls = 0;
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => {
      calls += 1;
      return createdResponse('ses-unsigned');
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    await expect(sessionIsAlive('ses-unsigned')).rejects.toThrow(
      /SANDBOX_TOKEN is not set/,
    );
    expect(calls).toBe(0);
  });
});

describe('sessionCancelExec', () => {
  test('a rotation asks for leftovers=keep; a Stop asks for nothing more', async () => {
    process.env.SANDBOX_URL = 'http://sandbox:8003';
    const urls: string[] = [];
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async (input: string) => {
      urls.push(input);
      return new Response(JSON.stringify({ killed: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    }) as any;

    expect(
      await sessionCancelExec('ses-1', 'turn-1', { keepLeftovers: true }),
    ).toBe(true);
    expect(await sessionCancelExec('ses-1', 'turn-2')).toBe(true);
    expect(urls).toEqual([
      'http://sandbox:8003/v1/sessions/ses-1/exec/turn-1/cancel?leftovers=keep',
      'http://sandbox:8003/v1/sessions/ses-1/exec/turn-2/cancel',
    ]);
  });
});

describe('sessionReadFile with a byte cap', () => {
  /** A file response streamed in chunks, with or without its length. */
  function fileResponse(
    chunks: number[],
    declare: boolean,
  ): { response: Response; pulled: () => number } {
    let pulled = 0;
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const size = chunks[index];
        index += 1;
        if (size === undefined) {
          controller.close();
          return;
        }
        pulled += size;
        controller.enqueue(new Uint8Array(size).fill(7));
      },
    });
    const total = chunks.reduce((sum, size) => sum + size, 0);
    return {
      response: new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          ...(declare ? { 'content-length': String(total) } : {}),
        },
      }),
      pulled: () => pulled,
    };
  }

  test('answers a file within the cap whole', async () => {
    const file = fileResponse([40, 60], true);
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => file.response) as any;
    const read = await sessionReadFile('ses-1', '/agent/workspace/a.png', {
      maxBytes: 100,
    });
    expect(read?.bytes.byteLength).toBe(100);
    expect(read?.contentType).toBe('application/octet-stream');
  });

  test('refuses a declared length over the cap before reading the body', async () => {
    const file = fileResponse([60, 60], true);
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => file.response) as any;
    const error = await sessionReadFile('ses-1', '/agent/workspace/a.png', {
      maxBytes: 100,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionFileTooLargeError);
    expect((error as SessionFileTooLargeError).maxBytes).toBe(100);
    // Refused unread: at most what the stream buffered ahead, never all of it.
    expect(file.pulled()).toBeLessThan(120);
  });

  test('stops reading an undeclared body at the first chunk past the cap', async () => {
    const file = fileResponse([60, 60, 60, 60], false);
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    globalThis.fetch = (async () => file.response) as any;
    await expect(
      sessionReadFile('ses-1', '/agent/workspace/a.png', { maxBytes: 100 }),
    ).rejects.toBeInstanceOf(SessionFileTooLargeError);
    expect(file.pulled()).toBeLessThan(240);
  });
});
