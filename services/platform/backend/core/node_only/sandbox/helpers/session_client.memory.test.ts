// An exec the session's runtime refused because the session's memory is
// nearly spent: the spawner answers the start with a 429
// `session_memory_busy`. Nothing ran, so the drain starts the exec again
// once the refusal's wait has passed, within its consecutive-failure budget,
// and past it hands the caller a refusal every lane already waits out.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { sandboxCapacityRefusal } from '../capacity_refusal';
import {
  drainSessionExecResilient,
  SessionExecLimitError,
  SessionMemoryBusyError,
  SpawnerStatusError,
} from './session_client';

const enc = new TextEncoder();

const RESULT_OK = `event: result\ndata: ${JSON.stringify({
  status: 'completed',
  exitCode: 0,
  durationMs: 1,
  stdoutBase64: '',
  stderrBase64: '',
  truncated: { stdout: false, stderr: false },
})}\n\n`;

function sseResponse(blocks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(enc.encode(block));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** The spawner forwarding runnerd's memory refusal. */
function memoryBusy(): Response {
  return Response.json(
    {
      error: 'session_memory_busy',
      code: 'SESSION_MEMORY_BUSY',
      message: 'the session is using 90% or more of its memory limit',
    },
    // Asked to come back at once, so the suite does not wait.
    { status: 429, headers: { 'retry-after': '0' } },
  );
}

const origFetch = globalThis.fetch;
const origToken = process.env.SANDBOX_TOKEN;
beforeEach(() => {
  process.env.SANDBOX_TOKEN = 'test-sandbox-token';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = origFetch;
  if (origToken === undefined) delete process.env.SANDBOX_TOKEN;
  else process.env.SANDBOX_TOKEN = origToken;
  vi.restoreAllMocks();
});

describe('an exec the session refused for want of memory', () => {
  test('starts again once the session has room, never attaching to the exec that never ran', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return calls.length <= 2 ? memoryBusy() : sseResponse([RESULT_OK]);
    }) as typeof fetch;

    const result = await drainSessionExecResilient(
      'ses-mem',
      { execId: 'exec-mem', command: ['x'], timeoutMs: 1_000 },
      new AbortController().signal,
      {},
      { contact: { onAttached() {}, onLost() {} } },
    );

    expect(result.status).toBe('completed');
    expect(calls.map((call) => call.method)).toEqual(['POST', 'POST', 'POST']);
    expect(calls.every((call) => !call.url.includes('/attach'))).toBe(true);
  });

  test('past the budget, is the session-room refusal every lane waits out', async () => {
    let posts = 0;
    globalThis.fetch = (async () => {
      posts += 1;
      return memoryBusy();
    }) as unknown as typeof fetch;

    const error = await drainSessionExecResilient(
      'ses-mem',
      { execId: 'exec-mem', command: ['x'], timeoutMs: 1_000 },
      new AbortController().signal,
      {},
    ).then(
      () => null,
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(SessionMemoryBusyError);
    expect(error).toBeInstanceOf(SessionExecLimitError);
    expect(String(error)).toContain(
      'the session is using 90% or more of its memory limit',
    );
    // The first start and five more: the consecutive-failure budget.
    expect(posts).toBe(6);
    expect(sandboxCapacityRefusal(error)).toEqual({
      scope: 'session',
      retryAfterMs: 15_000,
    });
  });

  test('any other 429 keeps reading as the spawner saying not now', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json(
        { error: 'host_memory' },
        { status: 429, headers: { 'retry-after': '3' } },
      );
    }) as unknown as typeof fetch;

    const error = await drainSessionExecResilient(
      'ses-host',
      { execId: 'exec-host', command: ['x'], timeoutMs: 1_000 },
      AbortSignal.timeout(200),
      {},
      { contact: { onAttached() {}, onLost() {} } },
    ).then(
      () => null,
      (failure: unknown) => failure,
    );

    // Ridden out as a spawner outage: one call, then the wait its hint
    // asks for, until the caller's window ends.
    expect(error).not.toBeInstanceOf(SessionMemoryBusyError);
    expect(error).not.toBeInstanceOf(SpawnerStatusError);
    expect(error instanceof Error && error.name).toBe('TimeoutError');
    expect(calls).toBe(1);
  });
});
