// Unit tests for the resilient exec drain (Stage 5). No spawner needed — global
// fetch is mocked to return SSE streams, including a mid-turn drop, and we
// assert the drain re-attaches via sinceSeq and feeds each delta exactly once.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  chunkStageFiles,
  drainSessionExecResilient,
  STAGE_BODY_BUDGET_BYTES,
  sessionCreate,
  sessionStageFiles,
  type SessionStageFile,
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
