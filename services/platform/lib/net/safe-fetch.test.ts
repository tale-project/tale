import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isPrivateIp,
  safeFetch,
  SafeFetchError,
  safeFetchBinary,
} from './safe-fetch';

describe('lib/http/safe_fetch.isPrivateIp', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '127.250.5.1',
    '10.0.0.5',
    '172.16.3.7',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '[::1]',
    'something.local',
    'fe80::abcd',
    'fc00::1',
    'fd12::5',
    // Bracketed IPv6 forms (URL.hostname keeps brackets for literals)
    '[fc00::1]',
    '[fd00:ec2::254]', // AWS IMDS IPv6
    '[fe80::1]',
    '[::ffff:7f00:1]', // IPv4-mapped 127.0.0.1 (hex)
    '[::ffff:127.0.0.1]', // IPv4-mapped 127.0.0.1 (dotted)
    '[::ffff:a9fe:a9fe]', // IPv4-mapped 169.254.169.254 (AWS IMDS)
  ])('rejects private / loopback / link-local: %s', (host) => {
    expect(isPrivateIp(host)).toBe(true);
  });

  it.each([
    'api.openai.com',
    'example.com',
    '1.1.1.1',
    '8.8.8.8',
    '172.15.0.1', // just outside 172.16/12
    '172.32.0.1', // just outside 172.16/12 upper bound
    '11.0.0.1', // just outside 10/8
  ])('accepts public host / address: %s', (host) => {
    expect(isPrivateIp(host)).toBe(false);
  });
});

describe('lib/http/safe_fetch.signal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tears the request down when the caller aborts, as its own kind', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      ),
    );
    const caller = new AbortController();
    const pending = safeFetch('https://example.com/slow', {
      signal: caller.signal,
      timeoutMs: 60_000,
    });
    caller.abort();

    await expect(pending).rejects.toMatchObject({
      name: 'SafeFetchError',
      kind: 'aborted',
    });
  });

  it('refuses at once when the caller signal is already aborted', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const caller = new AbortController();
    caller.abort();

    await expect(
      safeFetch('https://example.com/slow', { signal: caller.signal }),
    ).rejects.toBeInstanceOf(SafeFetchError);
    // No request left the process.
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});

describe('lib/net/safe-fetch redirects', () => {
  const ORIGIN = 'https://api.example.com';

  /** A fetch stub answering the scripted responses in order and recording
   * every request it saw (method, url, body, headers). */
  function scriptFetch(responses: Response[]) {
    const calls: {
      method: string;
      url: string;
      body: unknown;
      headers: Record<string, string>;
    }[] = [];
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        calls.push({
          method: init?.method ?? 'GET',
          url:
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          body: init?.body,
          headers: (init?.headers as Record<string, string>) ?? {},
        });
        const next = responses.shift();
        if (!next) throw new Error('unexpected extra fetch');
        return next;
      });
    return { calls, spy };
  }

  const redirect = (status: number, location: string) =>
    new Response(null, { status, headers: { Location: location } });
  const ok = (body = 'done') => new Response(body, { status: 200 });

  const postOptions = {
    method: 'POST' as const,
    headers: {
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
      'Content-Length': '9',
    },
    body: '{"a":1}',
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows a 303 to a POST with GET, no body and no body headers', async () => {
    const { calls } = scriptFetch([
      redirect(303, `${ORIGIN}/things/123`),
      ok(),
    ]);
    const res = await safeFetch(`${ORIGIN}/things`, postOptions);

    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe(`${ORIGIN}/things/123`);
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe('GET');
    expect(calls[1].body).toBeUndefined();
    expect(Object.keys(calls[1].headers)).toEqual(['Authorization']);
  });

  it('switches a 301/302 answered to a POST to GET', async () => {
    for (const status of [301, 302]) {
      const { calls, spy } = scriptFetch([
        redirect(status, `${ORIGIN}/moved`),
        ok(),
      ]);
      await safeFetch(`${ORIGIN}/things`, postOptions);
      expect(calls[1].method).toBe('GET');
      expect(calls[1].body).toBeUndefined();
      spy.mockRestore();
    }
  });

  it('keeps the method and body across a 307/308', async () => {
    for (const status of [307, 308]) {
      const { calls, spy } = scriptFetch([
        redirect(status, `${ORIGIN}/things-v2`),
        ok(),
      ]);
      await safeFetch(`${ORIGIN}/things`, postOptions);
      expect(calls[1].method).toBe('POST');
      expect(calls[1].body).toBe('{"a":1}');
      expect(calls[1].headers['Content-Type']).toBe('application/json');
      spy.mockRestore();
    }
  });

  it('leaves a GET → 302 and a HEAD → 303 unchanged', async () => {
    const get = scriptFetch([redirect(302, `${ORIGIN}/elsewhere`), ok()]);
    await safeFetch(`${ORIGIN}/things`);
    expect(get.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
    get.spy.mockRestore();

    const head = scriptFetch([redirect(303, `${ORIGIN}/elsewhere`), ok('')]);
    await safeFetch(`${ORIGIN}/things`, { method: 'HEAD' });
    expect(head.calls.map((c) => c.method)).toEqual(['HEAD', 'HEAD']);
  });

  it('applies the same switch in safeFetchBinary', async () => {
    const { calls } = scriptFetch([
      redirect(303, `${ORIGIN}/things/123`),
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }),
    ]);
    const res = await safeFetchBinary(`${ORIGIN}/things`, postOptions);

    expect(res.body.type).toBe('audio/mpeg');
    expect(res.finalUrl).toBe(`${ORIGIN}/things/123`);
    expect(calls[1].method).toBe('GET');
    expect(calls[1].body).toBeUndefined();
  });
});
