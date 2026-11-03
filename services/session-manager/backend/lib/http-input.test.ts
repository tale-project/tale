import { Hono } from 'hono';
import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';

import { AppError } from '../errors.ts';
import {
  MAX_BODY_BYTES,
  notFound,
  parseBody,
  parseOptionalBody,
  parseQuery,
  pathId,
  queryBoolean,
  readBodyText,
} from './http-input.ts';

/** What `read` made of a request: its value, or what it threw. */
interface Outcome<T> {
  value?: T;
  error?: unknown;
}

/** Runs `read` inside a route, the way a handler would, and says what came of it. */
async function inRoute<T>(
  read: (c: Context) => T | Promise<T>,
  path: string,
  init: RequestInit = {},
): Promise<Outcome<T>> {
  const outcome: Outcome<T> = {};
  const app = new Hono();
  app.all('/things/:id?', async (c) => {
    try {
      outcome.value = await read(c);
    } catch (error) {
      outcome.error = error;
    }
    return c.body(null, 204);
  });
  await app.request(`http://127.0.0.1:3004${path}`, init);
  return outcome;
}

function post(body: BodyInit): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  };
}

function issuesOf(error: unknown): Array<[string, string]> {
  expect(error).toBeInstanceOf(ZodError);
  if (!(error instanceof ZodError)) return [];
  return error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

const bodySchema = z.object({
  name: z.string(),
  os: z.enum(['random', 'linux']).default('random'),
});

describe('parseBody', () => {
  it('is the JSON body as the schema reads it, defaults filled in', async () => {
    const { value } = await inRoute(
      (c) => parseBody(c, bodySchema),
      '/things',
      post('{"name":"a","extra":1}'),
    );
    expect(value).toEqual({ name: 'a', os: 'random' });
  });

  it('reads UTF-8, a byte order mark and surrounding blanks', async () => {
    const bom = [0xef, 0xbb, 0xbf];
    const json = new TextEncoder().encode(' \n{"name":"Zoë ☃"}\n');
    const { value } = await inRoute(
      (c) => parseBody(c, bodySchema),
      '/things',
      post(new Uint8Array([...bom, ...json])),
    );
    expect(value).toEqual({ name: 'Zoë ☃', os: 'random' });
  });

  it('fails like any invalid body when the text is not JSON', async () => {
    const { error } = await inRoute(
      (c) => parseBody(c, bodySchema),
      '/things',
      post('{"name": '),
    );
    expect(issuesOf(error)).toEqual([
      ['', 'The request body is not valid JSON.'],
    ]);
  });

  it('fails as a missing object when there is no body', async () => {
    for (const init of [{ method: 'POST' }, post(''), post('  \n')]) {
      const { error } = await inRoute(
        (c) => parseBody(c, bodySchema),
        '/things',
        init,
      );
      expect(issuesOf(error)).toEqual([
        ['', 'Invalid input: expected object, received undefined'],
      ]);
    }
  });

  it('names the field that does not fit', async () => {
    const { error } = await inRoute(
      (c) => parseBody(c, bodySchema),
      '/things',
      post('{"name":5,"os":"beos"}'),
    );
    expect(issuesOf(error).map(([path]) => path)).toEqual(['name', 'os']);
  });

  it('does not keep the text of a body it refuses', async () => {
    const { error } = await inRoute(
      (c) => parseBody(c, bodySchema),
      '/things',
      post('{"name": "hunter2'),
    );
    expect(JSON.stringify(issuesOf(error))).not.toContain('hunter2');
  });
});

/** A request with a body that arrives in the given chunks; `pulled` counts those asked for. */
function chunkedRequest(
  chunks: Iterable<Uint8Array>,
  headers: Record<string, string> = {},
) {
  const iterator = chunks[Symbol.iterator]();
  const seen = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = iterator.next();
      if (next.done === true) controller.close();
      else {
        seen.pulled += 1;
        controller.enqueue(next.value);
      }
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  const request = new Request('http://127.0.0.1:3004/things', {
    method: 'POST',
    headers,
    body,
    // @ts-expect-error `duplex` is missing from the DOM types of RequestInit
    duplex: 'half',
  });
  return { request, seen };
}

describe('readBodyText', () => {
  const encoder = new TextEncoder();

  it('is 1 MiB, for the API and for the MCP endpoint', () => {
    expect(MAX_BODY_BYTES).toBe(1024 * 1024);
  });

  it('is the body as UTF-8 text, without a byte order mark', async () => {
    const bytes = encoder.encode('{"name":"Zoë ☃"}');
    const { request } = chunkedRequest([
      new Uint8Array([0xef, 0xbb, 0xbf]),
      bytes.subarray(0, 9),
      bytes.subarray(9),
    ]);
    expect(await readBodyText(request)).toBe('{"name":"Zoë ☃"}');
  });

  it('is empty when there is no body', async () => {
    const request = new Request('http://127.0.0.1:3004/things', {
      method: 'POST',
    });
    expect(await readBodyText(request)).toBe('');
  });

  it('takes a body of the largest size and refuses one byte more, with a 413', async () => {
    const limit = 10;
    const exact = chunkedRequest([
      encoder.encode('x'.repeat(5)),
      encoder.encode('x'.repeat(5)),
    ]);
    expect(await readBodyText(exact.request, limit)).toBe('x'.repeat(10));

    const over = chunkedRequest([
      encoder.encode('x'.repeat(5)),
      encoder.encode('x'.repeat(6)),
    ]);
    const refused = await readBodyText(over.request, limit).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({
      status: 413,
      code: 'validation_error',
      message: 'The request body is larger than 10 bytes.',
    });
  });

  it('measures bytes, not characters', async () => {
    // 4 characters, 12 bytes.
    const { request } = chunkedRequest([encoder.encode('☃☃☃☃')]);
    await expect(readBodyText(request, 11)).rejects.toMatchObject({
      status: 413,
    });
  });

  it('refuses what Content-Length says is too large without reading any of it', async () => {
    const { request, seen } = chunkedRequest([encoder.encode('x')], {
      'Content-Length': String(MAX_BODY_BYTES + 1),
    });
    await expect(readBodyText(request)).rejects.toMatchObject({ status: 413 });
    // Nobody took a reader: the stream (which fills one chunk by itself) is untouched.
    expect(request.bodyUsed).toBe(false);
    expect(request.body?.locked).toBe(false);
    expect(seen.pulled).toBeLessThanOrEqual(1);
  });

  it('stops reading a body that never ends, and lets go of it', async () => {
    // Nothing announces the size (chunked): the reader counts what comes.
    const chunk = encoder.encode('x'.repeat(100_000));
    function* endless(): Generator<Uint8Array> {
      for (;;) yield chunk;
    }
    const { request, seen } = chunkedRequest(endless());
    await expect(readBodyText(request)).rejects.toMatchObject({ status: 413 });
    const most = Math.ceil(MAX_BODY_BYTES / chunk.length) + 2;
    expect(seen.pulled).toBeLessThanOrEqual(most);
    expect(seen.cancelled).toBe(true);
  });
});

describe('parseBody of a body that is too large', () => {
  it('is refused with the 413, and the schema is not asked', async () => {
    const { error } = await inRoute(
      (c) => parseBody(c, bodySchema),
      '/things',
      post(`{"name":"${'x'.repeat(MAX_BODY_BYTES)}"}`),
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 413, code: 'validation_error' });
  });

  it('is refused for an optional body too', async () => {
    const { error } = await inRoute(
      (c) =>
        parseOptionalBody(c, z.object({ force: z.boolean().default(false) })),
      '/things',
      post(' '.repeat(MAX_BODY_BYTES + 1)),
    );
    expect(error).toMatchObject({ status: 413 });
  });
});

describe('parseOptionalBody', () => {
  it.each([
    ['no body', { method: 'POST' }],
    ['a body of blanks', post('  ')],
    ['null', post('null')],
  ])('reads %s as an empty object', async (_name, init) => {
    const { value } = await inRoute(
      (c) =>
        parseOptionalBody(c, z.object({ force: z.boolean().default(false) })),
      '/things',
      init,
    );
    expect(value).toEqual({ force: false });
  });

  it('reads a body that is there', async () => {
    const { value } = await inRoute(
      (c) =>
        parseOptionalBody(c, z.object({ force: z.boolean().default(false) })),
      '/things',
      post('{"force":true}'),
    );
    expect(value).toEqual({ force: true });
  });

  it('still refuses a body that is there and is not valid', async () => {
    const schema = z.object({ force: z.boolean().default(false) });
    const text = await inRoute(
      (c) => parseOptionalBody(c, schema),
      '/things',
      post('{'),
    );
    expect(issuesOf(text.error)).toEqual([
      ['', 'The request body is not valid JSON.'],
    ]);
    const type = await inRoute(
      (c) => parseOptionalBody(c, schema),
      '/things',
      post('{"force":"yes"}'),
    );
    expect(issuesOf(type.error).map(([path]) => path)).toEqual(['force']);
  });
});

describe('parseQuery', () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).optional(),
    force: queryBoolean.default(false),
  });

  it('is the query as the schema reads it', async () => {
    const { value } = await inRoute(
      (c) => parseQuery(c, schema),
      '/things?limit=5&force=yes&other=1',
    );
    expect(value).toEqual({ limit: 5, force: true });
  });

  it('is what the schema defaults to when the query is empty', async () => {
    const { value } = await inRoute((c) => parseQuery(c, schema), '/things');
    expect(value).toEqual({ force: false });
  });

  it('names the parameter that does not fit', async () => {
    const { error } = await inRoute(
      (c) => parseQuery(c, schema),
      '/things?limit=0&force=maybe',
    );
    expect(issuesOf(error).map(([path]) => path)).toEqual(['limit', 'force']);
  });
});

describe('queryBoolean', () => {
  it.each([
    ['1', true],
    ['on', true],
    ['t', true],
    ['true', true],
    ['TRUE', true],
    ['y', true],
    ['yes', true],
    ['0', false],
    ['off', false],
    ['f', false],
    ['false', false],
    ['n', false],
    ['No', false],
  ])('reads %s as %s', (text, expected) => {
    expect(queryBoolean.parse(text)).toBe(expected);
  });

  it.each(['', 'maybe', '2', 'enabled', ' true'])('refuses %j', (text) => {
    expect(queryBoolean.safeParse(text).success).toBe(false);
  });
});

describe('pathId', () => {
  const idOf = (path: string) => inRoute((c) => pathId(c, 'session'), path);

  it.each([
    ['1', 1],
    ['42', 42],
    ['007', 7],
    ['+5', 5],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('is the id in /things/%s', async (text, expected) => {
    expect((await idOf(`/things/${text}`)).value).toBe(expected);
  });

  it.each(['abc', '1.5', '1e3', '0x10', '--1', '1-', 'null', ' 1', '%201'])(
    'is a 422 for text that is no whole number: %j',
    async (text) => {
      const { error } = await idOf(`/things/${text}`);
      expect(issuesOf(error)).toEqual([
        [
          'id',
          'Input should be a valid integer, unable to parse string as an integer',
        ],
      ]);
    },
  );

  it('is a 422 when the route has no id', async () => {
    const { error } = await idOf('/things');
    expect(error).toBeInstanceOf(ZodError);
  });

  it.each([
    ['0', 'Session 0 does not exist.'],
    ['-0', 'Session 0 does not exist.'],
    ['-7', 'Session -7 does not exist.'],
    ['9007199254740992', 'Session 9007199254740992 does not exist.'],
    ['100000000000000000000', 'Session 100000000000000000000 does not exist.'],
  ])('is a 404 for an id no row can have: %s', async (text, message) => {
    const { error } = await idOf(`/things/${text}`);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      status: 404,
      code: 'session_not_found',
      message,
    });
  });

  it('names what the id would be of in the error', async () => {
    const proxy = await inRoute((c) => pathId(c, 'proxy'), '/things/0');
    const secret = await inRoute((c) => pathId(c, 'secret'), '/things/0');
    expect(proxy.error).toMatchObject({ code: 'proxy_not_found' });
    expect(secret.error).toMatchObject({ code: 'secret_not_found' });
  });
});

describe('notFound', () => {
  it('is the 404 of the manager for each kind of thing', () => {
    expect(notFound('session', 5).toBody()).toEqual({
      error: 'session_not_found',
      message: 'Session 5 does not exist.',
    });
    expect(notFound('proxy', '9').toBody()).toEqual({
      error: 'proxy_not_found',
      message: 'Proxy 9 does not exist.',
    });
    expect(notFound('secret', 1).status).toBe(404);
  });
});
