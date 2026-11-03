import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, apiJson, apiList, apiVoid, withQuery } from './client';

function reply(status: number, body?: unknown, headers: HeadersInit = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('withQuery', () => {
  it('appends only the values that are set', () => {
    expect(withQuery('/x', { a: 1, b: undefined, c: null, d: false })).toBe(
      '/x?a=1&d=false',
    );
    expect(withQuery('/x', {})).toBe('/x');
  });
});

describe('apiJson', () => {
  it('sends JSON and parses the answer with the schema', async () => {
    const fetchStub = vi.fn(async () => reply(200, { id: 3 }));
    vi.stubGlobal('fetch', fetchStub);
    const result = await apiJson(z.object({ id: z.number() }), 'POST', '/x', {
      body: { name: 'a' },
    });
    expect(result).toEqual({ id: 3 });
    expect(fetchStub).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{"name":"a"}',
      signal: undefined,
    });
  });

  it('sends no content type without a body', async () => {
    const fetchStub = vi.fn(async () => reply(200, {}));
    vi.stubGlobal('fetch', fetchStub);
    await apiJson(z.object({}), 'GET', '/x', { query: { limit: 5 } });
    expect(fetchStub).toHaveBeenCalledWith(
      '/api/x?limit=5',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('rejects an answer the schema does not accept as one the page cannot read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, { id: 'three' })),
    );
    const error = await apiJson(
      z.object({ id: z.number() }),
      'GET',
      '/x',
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, code: 'bad_answer' });
  });

  it('rejects an answer that is no JSON, such as the page of a server that is not ours, the same way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>hello</html>', { status: 200 })),
    );
    await expect(
      apiJson(z.object({ id: z.number() }), 'GET', '/x'),
    ).rejects.toMatchObject({ status: 200, code: 'bad_answer' });
  });

  it('turns an error answer into an ApiError with its code, sentence and extra fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply(409, {
          error: 'proxy_in_use',
          message: 'Session A uses this proxy.',
          session: { id: 1 },
        }),
      ),
    );
    const error = await apiJson(z.object({}), 'DELETE', '/x').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'proxy_in_use',
      message: 'Session A uses this proxy.',
      extra: { session: { id: 1 } },
    });
    // Not a structured error as the shared message helper reads it: its
    // sentence is printable.
    expect(error).not.toHaveProperty('data');
  });

  it('names an answer that is not ours an error of the server, and keeps its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>bad gateway</html>', {
            status: 502,
            statusText: 'Bad Gateway',
          }),
      ),
    );
    const error = await apiJson(z.object({}), 'GET', '/x').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      status: 502,
      code: 'server_error',
      extra: { status: 502 },
    });
    // The words of the status line are English and the page's to word, not the proxy's.
    expect(error).not.toHaveProperty('message', 'Bad Gateway');
  });

  it('names a JSON answer that is no error of ours the same', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(503, { status: 'unavailable' })),
    );
    await expect(apiJson(z.object({}), 'GET', '/x')).rejects.toMatchObject({
      status: 503,
      code: 'server_error',
    });
  });

  it('reports a call that got no answer as a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(apiJson(z.object({}), 'GET', '/x')).rejects.toMatchObject({
      status: 0,
      code: 'network',
    });
  });

  it('lets an abort through as an abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    );
    await expect(apiJson(z.object({}), 'GET', '/x')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('apiVoid', () => {
  it('accepts an answer without a body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(204)),
    );
    await expect(apiVoid('DELETE', '/x/1')).resolves.toBeUndefined();
  });
});

describe('apiList', () => {
  it('returns the rows and the size of the whole list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply(200, [{ id: 2 }, { id: 1 }], { 'X-Total-Count': '7' }),
      ),
    );
    expect(await apiList(z.object({ id: z.number() }), '/x')).toEqual({
      items: [{ id: 2 }, { id: 1 }],
      total: 7,
    });
  });

  it('never claims fewer rows than it holds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply(200, [{ id: 1 }, { id: 2 }], { 'X-Total-Count': '1' }),
      ),
    );
    expect((await apiList(z.object({ id: z.number() }), '/x')).total).toBe(2);
  });

  it('falls back to the rows it has without the header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, [{ id: 1 }])),
    );
    expect((await apiList(z.object({ id: z.number() }), '/x')).total).toBe(1);
  });

  it('refuses an answer that is not a list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, { id: 1 })),
    );
    await expect(
      apiList(z.object({ id: z.number() }), '/x'),
    ).rejects.toMatchObject({
      code: 'bad_answer',
    });
  });

  it('refuses a list with a row it cannot read, and an answer that is no JSON, the same way', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, [{ id: 1 }, { id: 'two' }])),
    );
    await expect(
      apiList(z.object({ id: z.number() }), '/x'),
    ).rejects.toMatchObject({ code: 'bad_answer' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html></html>', { status: 200 })),
    );
    await expect(
      apiList(z.object({ id: z.number() }), '/x'),
    ).rejects.toMatchObject({ code: 'bad_answer' });
  });
});
