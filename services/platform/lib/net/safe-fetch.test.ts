import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPrivateIp, safeFetch, SafeFetchError } from './safe-fetch';

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
