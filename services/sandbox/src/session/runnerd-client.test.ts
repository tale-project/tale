import { describe, expect, test } from 'bun:test';

import { runnerdStageFiles } from './runnerd-client.ts';

describe('runnerd staging admission', () => {
  test('retries an explicit busy refusal, then stages the unchanged request once', async () => {
    const bodies: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        bodies.push(await request.text());
        return bodies.length === 1
          ? Response.json({ error: 'staging_busy' }, { status: 503 })
          : Response.json({
              staged: [{ path: 'hello', bytes: 2 }],
              skipped: [],
            });
      },
    });
    try {
      expect(
        await runnerdStageFiles(
          { baseUrl: `http://127.0.0.1:${server.port}`, token: '' },
          [{ path: 'hello', contentBase64: 'aGk=' }],
        ),
      ).toEqual({ staged: [{ path: 'hello', bytes: 2 }], skipped: [] });
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toBe(bodies[1]);
    } finally {
      await server.stop(true);
    }
  });

  test('the retry wait shares the whole RPC deadline', async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return Response.json({ error: 'staging_busy' }, { status: 503 });
      },
    });
    try {
      const failure = await runnerdStageFiles(
        { baseUrl: `http://127.0.0.1:${server.port}`, token: '' },
        [],
        { timeoutMs: 25 },
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toMatch(/aborted|timed out/i);
      expect(calls).toBe(1);
    } finally {
      await server.stop(true);
    }
  });

  test('does not retry a possibly-applied request on a generic upstream failure', async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return Response.json({ error: 'internal' }, { status: 503 });
      },
    });
    try {
      const failure = await runnerdStageFiles(
        { baseUrl: `http://127.0.0.1:${server.port}`, token: '' },
        [],
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toContain('runnerd /files/stage 503');
      expect(calls).toBe(1);
    } finally {
      await server.stop(true);
    }
  });
});
