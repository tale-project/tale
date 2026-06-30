// Unit tests for the resilient exec drain (Stage 5). No spawner needed — global
// fetch is mocked to return SSE streams, including a mid-turn drop, and we
// assert the drain re-attaches via sinceSeq and feeds each delta exactly once.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { drainSessionExecResilient, sessionCreate } from './session_client';

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
    lastActivityAtMs: 1,
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
afterEach(() => {
  globalThis.fetch = origFetch;
});
beforeEach(() => {
  delete process.env.SANDBOX_TOKEN; // unsigned dev mode → no HMAC needed
});

describe('drainSessionExecResilient', () => {
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
