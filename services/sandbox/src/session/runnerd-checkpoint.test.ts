import { afterEach, describe, expect, test } from 'bun:test';

import { sessionRequestBodyLimit } from '../http-util.ts';
import { runnerdExecCheckpoint } from './runnerd-client.ts';
import {
  RUNNERD_CHECKPOINT_MAX_BYTES,
  RUNNERD_TOKEN_HEADER,
} from './runnerd-protocol.ts';

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(async () => {
  await server?.stop(true);
  server = undefined;
});

describe('checkpoint transport', () => {
  test('forwards opaque state and token without translating protocol refusals', async () => {
    const calls: Array<{
      path: string;
      method: string;
      token: string | null;
      body: string;
    }> = [];
    let status = 200;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        calls.push({
          path: new URL(req.url).pathname,
          method: req.method,
          token: req.headers.get(RUNNERD_TOKEN_HEADER),
          body: await req.text(),
        });
        return Response.json({ checkpoint: null }, { status });
      },
    });
    const opts = {
      baseUrl: server.url.toString().replace(/\/$/, ''),
      token: 'session-token',
    };
    const body = JSON.stringify({
      seq: 42,
      state: { partialLine: 'unfinished', pendingTasks: ['task'] },
    });
    const result = await runnerdExecCheckpoint(
      opts,
      'exec-1',
      'PUT',
      body,
      new AbortController().signal,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(calls).toEqual([
      {
        path: '/execs/exec-1/checkpoint',
        method: 'PUT',
        token: 'session-token',
        body,
      },
    ]);
    for (status of [404, 409, 413]) {
      const response = await runnerdExecCheckpoint(
        opts,
        'exec-1',
        'GET',
        '',
        new AbortController().signal,
      );
      expect(response.status).toBe(status);
    }
  });

  test('rejects oversized or invalid checkpoint cursors before the network', async () => {
    const opts = { baseUrl: 'http://127.0.0.1:1', token: 'token' };
    for (const value of [
      { seq: -1, state: {} },
      { seq: 1.5, state: {} },
      { seq: 1 },
      { seq: '1', state: {} },
    ]) {
      expect(
        (
          await runnerdExecCheckpoint(
            opts,
            'exec',
            'PUT',
            JSON.stringify(value),
            new AbortController().signal,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await runnerdExecCheckpoint(
          opts,
          'exec',
          'PUT',
          'x'.repeat(RUNNERD_CHECKPOINT_MAX_BYTES + 1),
          new AbortController().signal,
        )
      ).status,
    ).toBe(413);
  });

  test('checkpoint budget reaches server and device paths without enlarging other requests', () => {
    expect(
      sessionRequestBodyLimit(
        '/v1/sessions/session/exec/exec/checkpoint',
        262144,
      ),
    ).toBe(RUNNERD_CHECKPOINT_MAX_BYTES);
    expect(
      sessionRequestBodyLimit('/v1/sessions/session/files/stage', 262144),
    ).toBe(262144);
    expect(
      sessionRequestBodyLimit(
        '/v1/sessions/session/exec/exec/checkpoint/trailing',
        262144,
      ),
    ).toBe(262144);
  });
});
