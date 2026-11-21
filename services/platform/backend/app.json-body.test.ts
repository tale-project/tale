// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';

/**
 * The app door's JSON body reader as the REAL app wires it: a synthetic
 * router proves the reader (`lib/app-json-body.test.ts`); only `createApp`
 * proves every `/api/app` route reads through it. The route is the bare
 * `versionSchema.safeParse(await c.req.json())` of
 * `domains/users/routes.ts`, which answered a body-less POST with a
 * reported SyntaxError 500.
 */

function app() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the body is refused before any query
  const sql = (() => Promise.resolve([])) as unknown as Sql;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const auth = {
    resolveSessionAuthority: async (bundle: unknown) => bundle,
    api: {
      getSession: () =>
        Promise.resolve({
          user: { id: 'user-1', email: 'user@example.com', name: 'U' },
          session: { id: 's-1', activeOrganizationId: 'org-1' },
        }),
    },
    options: { baseURL: 'http://localhost' },
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
  } as unknown as Auth;
  return createApp({ sql, auth });
}

describe('app-door JSON bodies through the real app', () => {
  it.each([
    ['an empty body', ''],
    ['a truncated body', '{"version":"0.5'],
  ])('answers %s with 400 INVALID_JSON', async (_name, body) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app().request(
        'http://localhost/api/app/users/notification-state/toast-shown',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        },
      );
      expect(res.status).toBe(400);
      const id = res.headers.get('x-request-id');
      expect(id).not.toBeNull();
      expect(await res.json()).toEqual({
        error: 'The request body is not valid JSON',
        code: 'INVALID_JSON',
        requestId: id,
      });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

/**
 * The door's byte limit as the real app wires it
 * (`lib/app-body-limit.test.ts` proves the limit itself): every `/api/app`
 * route stands behind it, and the one door that takes a file does not.
 */
describe('app-door body size through the real app', () => {
  const OVER_BYTES = 16 * 1024 * 1024 + 1;
  const OVER = String(OVER_BYTES);

  /**
   * A body of exactly the bytes it declares, handed out in 64 KiB pieces,
   * that counts the pieces asked for. It ends, as a body on a socket does at
   * its declared length: a door that reads it reads 16 MiB and fails its
   * test. A body without an end has a door that reads it read until the
   * machine is out of memory, and no test timeout can stop it, since a
   * stream that always has a piece ready never lets a timer run.
   */
  function declaredBody(bytes: number) {
    let left = bytes;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        const piece = Math.min(left, 64 * 1024);
        left -= piece;
        if (piece > 0) controller.enqueue(new Uint8Array(piece));
        if (left === 0) controller.close();
      },
    });
    return { body, pulled: () => pulled };
  }

  it('refuses a body that declares more than 16 MiB, before reading it', async () => {
    const source = declaredBody(OVER_BYTES);

    const res = await app().request(
      'http://localhost/api/app/users/notification-state/toast-shown',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': OVER },
        body: source.body,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime asks for the option with a stream body; the typings do not know it
        ...({ duplex: 'half' } as unknown as RequestInit),
      },
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: 'The request body exceeds the 16 MiB limit',
      code: 'BODY_TOO_LARGE',
      requestId: res.headers.get('x-request-id'),
    });
    // Only what a stream queues ahead of any reader.
    expect(source.pulled()).toBeLessThanOrEqual(2);
  });

  it('leaves a body that large to the door that takes a file', async () => {
    const res = await app().request('http://localhost/api/app/files/upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': OVER,
      },
      body: new Uint8Array(8),
    });

    // Whatever that door makes of a request without an organization, it is
    // its own answer and not the limit's.
    expect(res.status).not.toBe(413);
  });
});
